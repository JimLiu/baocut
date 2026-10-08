//! 文档顶层 `events[]`（规范 §4.2）：画面 → 音频的事件表。
//!
//! 事件是给配乐 / 音效看的时刻，**渲染不读**。`bcut lint` 在这里校验（`t` 可解析、
//! `id` 唯一、`phase` 表达式合法），`bcut events` 用同一份求值导出按时间排序的行。
//!
//! - `t` / `until` 是 TimeExpr，在 `resolve()` 之后用 [`Resolver::eval_t_exact`] 求值：
//!   不对齐帧网格，结果按毫秒取整。
//! - `phase` 是 `u`（从 `t` 起算的秒）的表达式字符串，只许 `+ - * / ( )`、数字与
//!   `sin` / `cos` / `pow` / `floor`（`libm`，各目标逐位一致）。在 `[t, until]` 上按 1 ms
//!   扫描，相位每次**向上首次**越过 `k + 0.25` 出一行 `id#k`。
//!
//! 纯函数，不做 I/O。

use serde_json::{Map, Value, json};

use crate::json::JsonExt;
use crate::lint::Severity;
use crate::resolve::Resolver;

/// 相位越过 `k + PHASE_CROSSING` 时出一行（扇翅的下拍在周期的四分之一处）。
pub const PHASE_CROSSING: f64 = 0.25;
/// 相位扫描步长（毫秒）。
pub const PHASE_STEP_MS: u64 = 1;
/// 单个相位事件 `[t, until]` 的跨度上限（秒）：1 ms 一步，一小时是 360 万次求值。
pub const PHASE_MAX_SPAN: f64 = 3600.0;
/// 单个相位事件最多展开的行数。
pub const PHASE_MAX_ROWS: usize = 10_000;

/// 事件保留键：其余字段原样带进输出行。
const RESERVED: &[&str] = &["id", "t", "until", "phase"];

#[derive(Debug, Clone, PartialEq)]
pub struct EventIssue {
    pub rule: &'static str,
    pub severity: Severity,
    pub pointer: String,
    pub message: String,
}

/// 求值后的事件表。`rows` 已按 `(t, id)` 排序。
#[derive(Debug, Clone, Default)]
pub struct EventTable {
    pub rows: Vec<Value>,
    pub issues: Vec<EventIssue>,
}

impl EventTable {
    pub fn has_errors(&self) -> bool {
        self.issues
            .iter()
            .any(|issue| issue.severity == Severity::Error)
    }
}

/// 毫秒取整。
pub fn round_ms(t: f64) -> f64 {
    (t * 1000.0).round() / 1000.0
}

/// 时刻落在哪个场景：`[start, end)`，片尾那一刻归最后一个场景。
pub fn scene_at(scenes: &[(String, f64, f64)], t: f64) -> Option<(&str, f64)> {
    const EPS: f64 = 1e-9;
    scenes
        .iter()
        .find(|(_, start, end)| t >= start - EPS && t < end - EPS)
        .or_else(|| {
            scenes
                .last()
                .filter(|(_, start, end)| t >= start - EPS && t <= end + EPS)
        })
        .map(|(id, start, _)| (id.as_str(), round_ms(t - start)))
}

/// 一行事件的公共外形：`t` / `id` / `scene` / `sceneT` 加自由字段。
pub fn event_row(
    t: f64,
    id: &str,
    fields: &Map<String, Value>,
    scenes: &[(String, f64, f64)],
) -> Map<String, Value> {
    let mut row = Map::new();
    for (key, value) in fields {
        row.insert(key.clone(), value.clone());
    }
    let t = round_ms(t);
    row.insert("t".into(), json!(t));
    row.insert("id".into(), json!(id));
    match scene_at(scenes, t) {
        Some((scene, scene_t)) => {
            row.insert("scene".into(), json!(scene));
            row.insert("sceneT".into(), json!(scene_t));
        }
        None => {
            row.insert("scene".into(), Value::Null);
            row.insert("sceneT".into(), Value::Null);
        }
    }
    row
}

/// 按 `(t, id)` 排序，时刻相同按 id 定序，输出稳定。
pub fn sort_rows(rows: &mut [Value]) {
    rows.sort_by(|a, b| {
        let ta = a.get("t").and_then(Value::as_f64).unwrap_or(0.0);
        let tb = b.get("t").and_then(Value::as_f64).unwrap_or(0.0);
        ta.partial_cmp(&tb)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                let ia = a.get("id").and_then(Value::as_str).unwrap_or("");
                let ib = b.get("id").and_then(Value::as_str).unwrap_or("");
                ia.cmp(ib)
            })
    });
}

/// 文档有没有写 `events`（写了空数组也算：作者声明了「事件由文档说了算」）。
pub fn declares_events(doc: &Value) -> bool {
    doc.get_("events").is_some_and(|value| !value.is_null())
}

/// 求值整张事件表。`scenes` 是 IR 的 `(id, start, end)`，`total` 是全片时长。
/// 须在 `resolver.resolve()` 之后调用（`#clip` / `~word` 要窗口与转录）。
pub fn resolve_events(
    resolver: &Resolver,
    scenes: &[(String, f64, f64)],
    total: f64,
) -> EventTable {
    let mut table = EventTable::default();
    let mut issue = |rule, severity, pointer: String, message: String| {
        table.issues.push(EventIssue {
            rule,
            severity,
            pointer,
            message,
        })
    };
    let mut rows = Vec::new();
    let Some(events) = resolver.doc.get_("events").filter(|v| !v.is_null()) else {
        return table;
    };
    let Some(list) = events.as_array() else {
        issue(
            "schema",
            Severity::Error,
            "/events".into(),
            "`events` 须是数组".into(),
        );
        return table;
    };
    let mut seen: Vec<&str> = Vec::new();
    for (index, event) in list.iter().enumerate() {
        let ptr = format!("/events/{index}");
        let Some(map) = event.as_object() else {
            issue(
                "event-id-missing",
                Severity::Error,
                ptr,
                "事件须是对象 `{ id, t, … }`".into(),
            );
            continue;
        };
        let Some(id) = map
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.trim().is_empty())
        else {
            issue(
                "event-id-missing",
                Severity::Error,
                format!("{ptr}/id"),
                "事件缺 `id`（非空字符串）".into(),
            );
            continue;
        };
        if seen.contains(&id) {
            issue(
                "event-id-duplicate",
                Severity::Error,
                format!("{ptr}/id"),
                format!("事件 id \"{id}\" 重复"),
            );
            continue;
        }
        seen.push(id);

        let eval = |key: &str| -> Result<f64, String> {
            let expr = map.get(key).unwrap_or(&Value::Null);
            if expr.is_null() {
                return Err(format!("缺 `{key}`"));
            }
            match resolver.eval_t_exact(expr) {
                Ok(Some(t)) if t.is_finite() => Ok(t),
                Ok(Some(_)) => Err(format!("`{key}` = {expr} 不是有限时刻")),
                Ok(None) => Err(format!("`{key}` = {expr} 引用的窗口没有解出")),
                Err(error) => Err(format!("`{key}` = {expr}：{error}")),
            }
        };
        let t = match eval("t") {
            Ok(t) => round_ms(t),
            Err(message) => {
                issue(
                    "event-time-invalid",
                    Severity::Error,
                    format!("{ptr}/t"),
                    format!("事件 \"{id}\"：{message}"),
                );
                continue;
            }
        };
        let until = match map.get("until").filter(|v| !v.is_null()) {
            None => None,
            Some(_) => match eval("until") {
                Ok(until) if round_ms(until) >= t => Some(round_ms(until)),
                Ok(until) => {
                    issue(
                        "event-time-invalid",
                        Severity::Error,
                        format!("{ptr}/until"),
                        format!(
                            "事件 \"{id}\"：`until` = {:.3}s 早于 `t` = {t:.3}s",
                            round_ms(until)
                        ),
                    );
                    continue;
                }
                Err(message) => {
                    issue(
                        "event-time-invalid",
                        Severity::Error,
                        format!("{ptr}/until"),
                        format!("事件 \"{id}\"：{message}"),
                    );
                    continue;
                }
            },
        };
        let outside = |at: f64| at < -1e-9 || at > total + 1e-9;
        if outside(t) || until.is_some_and(outside) {
            issue(
                "event-outside-doc",
                Severity::Warn,
                ptr.clone(),
                format!("事件 \"{id}\" 落在全片 [0, {total:.3}s] 之外"),
            );
        }

        let mut fields: Map<String, Value> = map
            .iter()
            .filter(|(key, _)| !RESERVED.contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();

        match map.get("phase").filter(|v| !v.is_null()) {
            None => {
                if let Some(until) = until {
                    fields.insert("until".into(), json!(until));
                }
                rows.push(Value::Object(event_row(t, id, &fields, scenes)));
            }
            Some(phase) => {
                let pointer = format!("{ptr}/phase");
                let Some(text) = phase.as_str() else {
                    issue(
                        "event-phase-invalid",
                        Severity::Error,
                        pointer,
                        format!("事件 \"{id}\"：`phase` 须是 u 的表达式字符串"),
                    );
                    continue;
                };
                let Some(until) = until else {
                    issue(
                        "event-phase-invalid",
                        Severity::Error,
                        pointer,
                        format!("事件 \"{id}\"：写了 `phase` 就要写 `until`（扫描到哪里为止）"),
                    );
                    continue;
                };
                let expr = match PhaseExpr::parse(text) {
                    Ok(expr) => expr,
                    Err(message) => {
                        issue(
                            "event-phase-invalid",
                            Severity::Error,
                            pointer,
                            format!("事件 \"{id}\"：phase \"{text}\"：{message}"),
                        );
                        continue;
                    }
                };
                match phase_crossings(&expr, until - t) {
                    Ok(crossings) => {
                        fields.insert("event".into(), json!(id));
                        for (u, k) in crossings {
                            let mut row_fields = fields.clone();
                            row_fields.insert("phaseIndex".into(), json!(k));
                            rows.push(Value::Object(event_row(
                                t + u,
                                &format!("{id}#{k}"),
                                &row_fields,
                                scenes,
                            )));
                        }
                    }
                    Err(message) => issue(
                        "event-phase-invalid",
                        Severity::Error,
                        pointer,
                        format!("事件 \"{id}\"：phase \"{text}\"：{message}"),
                    ),
                }
            }
        }
    }
    sort_rows(&mut rows);
    table.rows = rows;
    table
}

/// 在 `u ∈ (0, span]` 上按 1 ms 扫描，返回每次向上首次越过 `k + 0.25` 的 `(u, k)`。
/// 同一毫秒越过几个整数就出几行；相位回落后再升回来不重复出（只数新高）。
pub fn phase_crossings(expr: &PhaseExpr, span: f64) -> Result<Vec<(f64, i64)>, String> {
    if !(span >= 0.0) || span > PHASE_MAX_SPAN {
        return Err(format!("扫描跨度 {span:.3}s 超出 0–{PHASE_MAX_SPAN}s"));
    }
    let level = |u: f64| -> Result<i64, String> {
        let value = expr.eval(u);
        if !value.is_finite() {
            return Err(format!("u = {u:.3} 处相位不是有限数"));
        }
        Ok(libm::floor(value - PHASE_CROSSING) as i64)
    };
    let steps = libm::round(span * 1000.0) as u64 / PHASE_STEP_MS;
    let mut high = level(0.0)?;
    let mut out = Vec::new();
    for step in 1..=steps {
        let u = (step * PHASE_STEP_MS) as f64 / 1000.0;
        let k = level(u)?;
        while high < k {
            high += 1;
            out.push((u, high));
            if out.len() > PHASE_MAX_ROWS {
                return Err(format!("展开超过 {PHASE_MAX_ROWS} 行"));
            }
        }
    }
    Ok(out)
}

/// `phase` 表达式：`u` 的算术式，编译期解析一次、扫描时反复求值。
#[derive(Debug, Clone, PartialEq)]
pub enum PhaseExpr {
    Num(f64),
    U,
    Neg(Box<PhaseExpr>),
    Bin(char, Box<PhaseExpr>, Box<PhaseExpr>),
    Call(PhaseFn, Vec<PhaseExpr>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhaseFn {
    Sin,
    Cos,
    Pow,
    Floor,
}

impl PhaseFn {
    fn parse(name: &str) -> Option<(Self, usize)> {
        Some(match name {
            "sin" => (Self::Sin, 1),
            "cos" => (Self::Cos, 1),
            "floor" => (Self::Floor, 1),
            "pow" => (Self::Pow, 2),
            _ => return None,
        })
    }
}

impl PhaseExpr {
    pub fn parse(text: &str) -> Result<PhaseExpr, String> {
        let tokens = tokenize(text)?;
        let mut parser = Parser { tokens, pos: 0 };
        let expr = parser.expr()?;
        if parser.pos != parser.tokens.len() {
            return Err(format!("多余的 {:?}", parser.tokens[parser.pos]));
        }
        Ok(expr)
    }

    pub fn eval(&self, u: f64) -> f64 {
        match self {
            Self::Num(n) => *n,
            Self::U => u,
            Self::Neg(inner) => -inner.eval(u),
            Self::Bin(op, a, b) => {
                let (a, b) = (a.eval(u), b.eval(u));
                match op {
                    '+' => a + b,
                    '-' => a - b,
                    '*' => a * b,
                    _ => a / b,
                }
            }
            Self::Call(f, args) => match f {
                PhaseFn::Sin => libm::sin(args[0].eval(u)),
                PhaseFn::Cos => libm::cos(args[0].eval(u)),
                PhaseFn::Floor => libm::floor(args[0].eval(u)),
                PhaseFn::Pow => libm::pow(args[0].eval(u), args[1].eval(u)),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Num(f64),
    Ident(String),
    Sym(char),
}

fn tokenize(text: &str) -> Result<Vec<Token>, String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if c.is_ascii_digit() || c == '.' {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let literal: String = chars[start..i].iter().collect();
            let value = literal
                .parse::<f64>()
                .map_err(|_| format!("数字 \"{literal}\" 写法不对"))?;
            out.push(Token::Num(value));
        } else if c.is_ascii_alphabetic() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_alphanumeric() {
                i += 1;
            }
            out.push(Token::Ident(chars[start..i].iter().collect()));
        } else if "+-*/(),".contains(c) {
            out.push(Token::Sym(c));
            i += 1;
        } else {
            return Err(format!(
                "不认识的字符 '{c}'（只许 + - * / ( ) 、数字、u 与 sin / cos / pow / floor）"
            ));
        }
    }
    if out.is_empty() {
        return Err("表达式是空的".into());
    }
    Ok(out)
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn eat(&mut self, sym: char) -> bool {
        if self.peek() == Some(&Token::Sym(sym)) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expr(&mut self) -> Result<PhaseExpr, String> {
        let mut left = self.term()?;
        loop {
            let op = if self.eat('+') {
                '+'
            } else if self.eat('-') {
                '-'
            } else {
                return Ok(left);
            };
            left = PhaseExpr::Bin(op, Box::new(left), Box::new(self.term()?));
        }
    }

    fn term(&mut self) -> Result<PhaseExpr, String> {
        let mut left = self.unary()?;
        loop {
            let op = if self.eat('*') {
                '*'
            } else if self.eat('/') {
                '/'
            } else {
                return Ok(left);
            };
            left = PhaseExpr::Bin(op, Box::new(left), Box::new(self.unary()?));
        }
    }

    fn unary(&mut self) -> Result<PhaseExpr, String> {
        if self.eat('-') {
            return Ok(PhaseExpr::Neg(Box::new(self.unary()?)));
        }
        if self.eat('+') {
            return self.unary();
        }
        self.primary()
    }

    fn primary(&mut self) -> Result<PhaseExpr, String> {
        let Some(token) = self.peek().cloned() else {
            return Err("表达式不完整".into());
        };
        self.pos += 1;
        match token {
            Token::Num(n) => Ok(PhaseExpr::Num(n)),
            Token::Sym('(') => {
                let inner = self.expr()?;
                if !self.eat(')') {
                    return Err("缺右括号".into());
                }
                Ok(inner)
            }
            Token::Ident(name) if name == "u" => Ok(PhaseExpr::U),
            Token::Ident(name) => {
                let (f, arity) = PhaseFn::parse(&name).ok_or_else(|| {
                    format!("不认识的名字 \"{name}\"（只许 u 与 sin / cos / pow / floor）")
                })?;
                if !self.eat('(') {
                    return Err(format!("{name} 后面要跟括号"));
                }
                let mut args = vec![self.expr()?];
                while self.eat(',') {
                    args.push(self.expr()?);
                }
                if !self.eat(')') {
                    return Err(format!("{name}(…) 缺右括号"));
                }
                if args.len() != arity {
                    return Err(format!("{name} 要 {arity} 个参数，给了 {}", args.len()));
                }
                Ok(PhaseExpr::Call(f, args))
            }
            Token::Sym(c) => Err(format!("这里不该出现 '{c}'")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_expressions_parse_and_evaluate_with_precedence() {
        let expr = PhaseExpr::parse("u*2.6+0.2").unwrap();
        assert!((expr.eval(1.0) - 2.8).abs() < 1e-12);
        let expr = PhaseExpr::parse("-(u - 1) * 2 / 4 + pow(2, 3) + floor(1.7)").unwrap();
        assert!((expr.eval(3.0) - (-1.0 + 8.0 + 1.0)).abs() < 1e-12);
        let expr = PhaseExpr::parse("sin(u) + cos(0)").unwrap();
        assert!((expr.eval(0.0) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn phase_expressions_reject_anything_outside_the_whitelist() {
        for bad in [
            "",
            "u +",
            "exp(u)",
            "u ** 2",
            "pow(u)",
            "sin u",
            "(u",
            "u; 1",
            "Math.sin(u)",
        ] {
            assert!(PhaseExpr::parse(bad).is_err(), "{bad}");
        }
    }

    /// 相位 `u*2.6+0.2` 在 u = (k + 0.05)/2.6 越过 k+0.25：1 ms 扫描落在其后第一个毫秒。
    #[test]
    fn crossings_are_found_on_the_millisecond_grid() {
        let expr = PhaseExpr::parse("u*2.6+0.2").unwrap();
        let crossings = phase_crossings(&expr, 2.6).unwrap();
        let expected: Vec<(f64, i64)> = (0..7)
            .map(|k| {
                let exact = (k as f64 + 0.05) / 2.6;
                (libm::ceil(exact * 1000.0 - 1e-9) / 1000.0, k)
            })
            .filter(|(u, _)| *u <= 2.6)
            .collect();
        assert_eq!(crossings.len(), expected.len());
        for ((u, k), (eu, ek)) in crossings.iter().zip(&expected) {
            assert_eq!(k, ek);
            assert!((u - eu).abs() < 1e-9, "{u} vs {eu}");
        }
        // 回落再升回来不重复出行
        let wobble = PhaseExpr::parse("sin(u*6.283185307179586)").unwrap();
        assert_eq!(phase_crossings(&wobble, 3.0).unwrap().len(), 1);
    }
}
