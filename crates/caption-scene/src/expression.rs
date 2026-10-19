use crate::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ValueType {
    Scalar,
    Integer,
    Length,
    Time,
    Angle,
    Bool,
    Color,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum Expression {
    Literal {
        #[serde(rename = "type")]
        value_type: ValueType,
        value: Value,
    },
    Read {
        path: String,
    },
    Call {
        function: String,
        args: Vec<Expression>,
    },
    If {
        condition: Box<Expression>,
        then: Box<Expression>,
        #[serde(rename = "else")]
        otherwise: Box<Expression>,
    },
}
#[derive(Clone, Debug, PartialEq)]
pub enum Evaluated {
    Number(ValueType, f64),
    Bool(bool),
    Color([f64; 4]),
}
impl Evaluated {
    pub fn value_type(&self) -> ValueType {
        match self {
            Self::Number(t, _) => *t,
            Self::Bool(_) => ValueType::Bool,
            Self::Color(_) => ValueType::Color,
        }
    }
    pub fn number(&self) -> Result<f64> {
        match self {
            Self::Number(_, v) => Ok(*v),
            _ => Err(invalid("value", "number required")),
        }
    }
    pub fn boolean(&self) -> Result<bool> {
        match self {
            Self::Bool(v) => Ok(*v),
            _ => Err(invalid("value", "boolean required")),
        }
    }
    pub fn finite(self) -> Result<Self> {
        if matches!(&self, Self::Number(_, n) if !n.is_finite()) || matches!(&self, Self::Color(c) if c.iter().any(|n| !n.is_finite())) {
            return Err(invalid("expression", "non-finite result"));
        }
        Ok(self)
    }
}
pub fn color(s: &str) -> Result<[f64; 4]> {
    let h = s.strip_prefix('#').ok_or_else(|| invalid("color", "expected hexadecimal color"))?;
    if !matches!(h.len(), 6 | 8) || !h.is_ascii() {
        return Err(invalid("color", "expected RRGGBB or RRGGBBAA"));
    }
    let mut c = [1.0; 4];
    for (i, v) in c.iter_mut().enumerate().take(h.len() / 2) {
        *v = u8::from_str_radix(&h[i * 2..i * 2 + 2], 16).map_err(|_| invalid("color", "invalid hexadecimal color"))? as f64 / 255.0;
    }
    Ok(c)
}
pub fn typed_value(t: ValueType, value: &Value) -> Result<Evaluated> {
    match t {
        ValueType::Color => Ok(Evaluated::Color(color(
            value.as_str().ok_or_else(|| invalid("value", "color string required"))?,
        )?)),
        ValueType::Bool => value
            .as_bool()
            .map(Evaluated::Bool)
            .ok_or_else(|| invalid("value", "boolean required")),
        _ => {
            let n = value
                .as_f64()
                .filter(|n| n.is_finite())
                .ok_or_else(|| invalid("value", "finite number required"))?;
            if t == ValueType::Integer && (n.fract() != 0.0 || n.abs() > 9_007_199_254_740_991.0) {
                return Err(invalid("value", "safe integer required"));
            }
            Ok(Evaluated::Number(t, n))
        }
    }
}
pub fn context_type(path: &str) -> Option<ValueType> {
    Some(match path {
        "time.elapsedSeconds"
        | "time.seconds"
        | "time.durationSeconds"
        | "time.cueDurationSeconds"
        | "time.pageElapsedSeconds"
        | "time.pageDurationSeconds"
        | "time.lineElapsedSeconds"
        | "time.lineDurationSeconds"
        | "time.pageLastWordElapsedSeconds"
        | "time.pageLastWordDurationSeconds"
        | "time.cueFirstWordStartSeconds"
        | "time.cueFirstWordEndSeconds"
        | "time.cueSecondWordStartSeconds"
        | "time.nextWordStartSeconds"
        | "time.firstPageFirstWordStartSeconds"
        | "time.firstPageLastWordEndSeconds"
        | "time.firstPageNextWordStartSeconds"
        | "time.pageFirstWordStartSeconds"
        | "time.pageNextWordStartSeconds"
        | "time.activeWordElapsedSeconds"
        | "time.activeWordDurationSeconds" => ValueType::Time,
        "unit.textIndex"
        | "unit.textCount"
        | "unit.pageTextIndex"
        | "unit.pageTextCount"
        | "unit.pageIndex"
        | "unit.pageCount"
        | "unit.pageLineCount"
        | "time.progress"
        | "time.clampedProgress"
        | "unit.index"
        | "unit.count"
        | "unit.selectedIndex"
        | "unit.selectedCount"
        | "unit.cueWordIndex"
        | "unit.cueWordCount"
        | "unit.cueLineIndex"
        | "unit.cueLineCount"
        | "unit.cueSelectedIndex"
        | "unit.cueSelectedCount"
        | "unit.activeWordIndexInPage" => ValueType::Scalar,
        "unit.labelInkAvailable"
        | "unit.active"
        | "unit.read"
        | "unit.unread"
        | "unit.pageLastWordTimed"
        | "unit.cueFirstWordTimed"
        | "unit.cueSecondWordTimed"
        | "unit.wordTimed"
        | "unit.pageEnvelopeAvailable"
        | "unit.nextWordTimed"
        | "unit.firstPageFirstWordTimed"
        | "unit.firstPageLastWordTimed"
        | "unit.firstPageNextWordTimed"
        | "unit.pageFirstWordTimed"
        | "unit.pageNextWordTimed"
        | "unit.cueWordBound"
        | "unit.cueLineBound"
        | "unit.cueSelectionAvailable"
        | "unit.lineEnvelopeAvailable"
        | "unit.rangeInkAvailable"
        | "unit.activeWordAvailable"
        | "unit.previousWordInLine" => ValueType::Bool,
        "layout.labelWidth"
        | "layout.labelHeight"
        | "layout.labelMaxGlyphInkWidth"
        | "layout.labelMaxGlyphInkHeight"
        | "layout.x"
        | "layout.y"
        | "layout.width"
        | "layout.pageEnvelopeY"
        | "layout.pageEnvelopeHeight"
        | "layout.pageMaxFontSize"
        | "layout.height"
        | "layout.baseline"
        | "layout.inkX"
        | "layout.inkY"
        | "layout.inkWidth"
        | "layout.inkHeight"
        | "layout.lineInkY"
        | "layout.lineInkHeight"
        | "layout.lineEnvelopeY"
        | "layout.lineEnvelopeHeight"
        | "layout.firstInkLeft"
        | "layout.lastInkRight"
        | "layout.previousWordX"
        | "layout.previousWordY"
        | "layout.previousWordWidth"
        | "layout.previousWordHeight"
        | "layout.lineBoxX"
        | "layout.lineBoxY"
        | "layout.lineBoxWidth"
        | "layout.lineBoxHeight"
        | "canvas.width"
        | "canvas.height" => ValueType::Length,
        _ => return None,
    })
}
fn require_context_capability(path: &str, scene: &Scene) -> Result<()> {
    if matches!(
        path,
        "layout.labelWidth"
            | "layout.labelHeight"
            | "layout.labelMaxGlyphInkWidth"
            | "layout.labelMaxGlyphInkHeight"
            | "unit.labelInkAvailable"
    ) && !scene.required_capabilities.iter().any(|c| c == "caption-bound-label/1")
    {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_UNAVAILABLE",
            path,
            "caption-bound-label/1 must be declared",
        ));
    }
    if matches!(
        path,
        "layout.pageEnvelopeY"
            | "layout.pageEnvelopeHeight"
            | "layout.pageMaxFontSize"
            | "unit.pageLineCount"
            | "unit.pageEnvelopeAvailable"
    ) && !scene.required_capabilities.iter().any(|c| c == "caption-page-envelope/1")
    {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_UNAVAILABLE",
            path,
            "caption-page-envelope/1 must be declared",
        ));
    }

    if matches!(
        path,
        "layout.lineEnvelopeY"
            | "layout.lineEnvelopeHeight"
            | "layout.firstInkLeft"
            | "layout.lastInkRight"
            | "unit.lineEnvelopeAvailable"
            | "unit.rangeInkAvailable"
    ) && !scene.required_capabilities.iter().any(|c| c == "caption-glyph-envelope/1")
    {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_UNAVAILABLE",
            path,
            "caption-glyph-envelope/1 must be declared",
        ));
    }
    if matches!(
        path,
        "unit.cueWordIndex"
            | "unit.cueWordCount"
            | "unit.cueLineIndex"
            | "unit.cueLineCount"
            | "unit.cueSelectedIndex"
            | "unit.cueSelectedCount"
            | "unit.cueWordBound"
            | "unit.cueLineBound"
            | "unit.cueSelectionAvailable"
    ) && !scene.required_capabilities.iter().any(|c| c == "caption-cue-unit-context/1")
    {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_UNAVAILABLE",
            path,
            "caption-cue-unit-context/1 must be declared",
        ));
    }
    if matches!(
        path,
        "unit.activeWordAvailable" | "unit.activeWordIndexInPage" | "time.activeWordElapsedSeconds" | "time.activeWordDurationSeconds"
    ) && !scene.required_capabilities.iter().any(|c| c == "caption-active-word-context/1")
    {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_UNAVAILABLE",
            path,
            "caption-active-word-context/1 must be declared",
        ));
    }
    if matches!(
        path,
        "unit.previousWordInLine"
            | "layout.previousWordX"
            | "layout.previousWordY"
            | "layout.previousWordWidth"
            | "layout.previousWordHeight"
    ) && !scene.required_capabilities.iter().any(|c| c == "caption-line-neighbor-context/1")
    {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_UNAVAILABLE",
            path,
            "caption-line-neighbor-context/1 must be declared",
        ));
    }
    if matches!(
        path,
        "layout.lineBoxX" | "layout.lineBoxY" | "layout.lineBoxWidth" | "layout.lineBoxHeight"
    ) && !scene.required_capabilities.iter().any(|c| c == "caption-line-box-context/1")
    {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_UNAVAILABLE",
            path,
            "caption-line-box-context/1 must be declared",
        ));
    }
    if matches!(path, "time.lineElapsedSeconds" | "time.lineDurationSeconds") && crate::validate::unit_font_reflow(scene) {
        return Err(Diagnostic::new(
            "CAPTION_SCENE_INVALID",
            path,
            "rewrapped lines have no stable clock",
        ));
    }
    Ok(())
}
pub fn builtin_type(name: &str, args: &[ValueType]) -> Option<ValueType> {
    use ValueType::*;
    let numeric = |t| matches!(t, Scalar | Integer | Length | Time | Angle);
    match (name, args) {
        ("add" | "sub" | "min" | "max", [a, b]) if a == b && numeric(*a) => Some(*a),
        ("mul", [Scalar, Integer] | [Integer, Scalar]) => Some(Scalar),
        ("div", [Integer, Scalar | Integer]) => Some(Scalar),
        ("mix", [Integer, Integer, Scalar]) => Some(Scalar),
        ("mul", [Scalar | Integer, b]) | ("mul", [b, Scalar | Integer]) if numeric(*b) => Some(*b),
        ("div", [a, Scalar | Integer]) if numeric(*a) => Some(*a),
        ("div", [a, b]) if a == b && numeric(*a) => Some(Scalar),
        ("abs", [a]) if numeric(*a) => Some(*a),
        ("floor" | "ceil", [Scalar]) => Some(Scalar),
        ("sin" | "cos", [Angle]) => Some(Scalar),
        ("phase", [Time, Scalar]) => Some(Angle),
        ("mix", [a, b, Scalar]) if a == b && (numeric(*a) || *a == Color) => Some(*a),
        ("clamp", [a, b, c]) if a == b && b == c && numeric(*a) => Some(*a),
        ("smoothstep" | "sqrt", [Scalar]) => Some(Scalar),
        ("cubic-bezier", [Scalar, Scalar, Scalar, Scalar, Scalar]) => Some(Scalar),
        ("eq", [a, b]) if a == b => Some(Bool),
        ("lt" | "gt", [a, b]) if a == b && numeric(*a) => Some(Bool),
        ("and" | "or", [Bool, Bool]) | ("not", [Bool]) => Some(Bool),
        ("random" | "noise", [Scalar]) => Some(Scalar),
        ("shuffle-index", [Scalar, Scalar, Scalar]) => Some(Scalar),
        _ => None,
    }
}
pub fn infer(expr: &Expression, scene: &Scene, arguments: &BTreeMap<String, ValueType>) -> Result<ValueType> {
    if scene
        .required_capabilities
        .iter()
        .any(|capability| capability == "caption-function-dag/1")
    {
        return infer_dag(expr, scene, arguments);
    }
    fn inner(e: &Expression, s: &Scene, a: &BTreeMap<String, ValueType>, stack: &mut Vec<String>, budget: &mut usize) -> Result<ValueType> {
        if *budget == 0 || stack.len() > 32 {
            return Err(Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "expression", "expression expansion"));
        }
        *budget -= 1;
        match e {
            Expression::Literal { value_type, value } => {
                typed_value(*value_type, value)?;
                Ok(*value_type)
            }
            Expression::Read { path } => {
                require_context_capability(path, s)?;
                let t = if let Some(id) = path.strip_prefix("params.") {
                    s.parameters.iter().find(|p| p.id == id).map(|p| p.value_type)
                } else if let Some(id) = path.strip_prefix("args.") {
                    a.get(id).copied()
                } else {
                    context_type(path)
                };
                t.ok_or_else(|| Diagnostic::new("CAPTION_EXPRESSION_TYPE", path, "unknown context field"))
            }
            Expression::If {
                condition,
                then,
                otherwise,
            } => {
                if inner(condition, s, a, stack, budget)? != ValueType::Bool {
                    return Err(invalid("if", "boolean condition required"));
                }
                let t = inner(then, s, a, stack, budget)?;
                if inner(otherwise, s, a, stack, budget)? != t {
                    return Err(invalid("if", "branch types differ"));
                }
                Ok(t)
            }
            Expression::Call { function, args } => {
                let ts = args.iter().map(|x| inner(x, s, a, stack, budget)).collect::<Result<Vec<_>>>()?;
                if let Some(t) = builtin_type(function, &ts) {
                    return Ok(t);
                }
                let f =
                    s.functions.iter().find(|f| f.id == *function).ok_or_else(|| {
                        Diagnostic::new("CAPTION_EXPRESSION_TYPE", function, "unknown function or invalid argument types")
                    })?;
                if stack.contains(function) {
                    return Err(Diagnostic::new("CAPTION_DEPENDENCY_CYCLE", function, "recursive function"));
                }
                if f.arguments.len() != ts.len() || f.arguments.iter().zip(&ts).any(|(a, t)| a.value_type != *t) {
                    return Err(invalid(function, "argument types differ"));
                }
                stack.push(function.clone());
                let inner_args = f.arguments.iter().map(|a| (a.name.clone(), a.value_type)).collect();
                let t = inner(&f.body, s, &inner_args, stack, budget)?;
                stack.pop();
                if t != f.returns {
                    return Err(invalid(function, "return type differs"));
                }
                Ok(t)
            }
        }
    }
    inner(expr, scene, arguments, &mut Vec::new(), &mut 4096)
}
#[derive(Clone, Copy)]
struct FunctionTypeSummary {
    value_type: ValueType,
    /// Maximum evaluator depth below this expression, including called bodies.
    height: usize,
}

/// Opt-in validation counts each dependency body once while checking every call's arguments.
fn infer_dag(expr: &Expression, scene: &Scene, arguments: &BTreeMap<String, ValueType>) -> Result<ValueType> {
    struct Checker<'a> {
        scene: &'a Scene,
        memo: BTreeMap<String, FunctionTypeSummary>,
        visiting: std::collections::BTreeSet<String>,
        unique_nodes: usize,
    }
    impl Checker<'_> {
        fn visit(
            &mut self,
            e: &Expression,
            arguments: &BTreeMap<String, ValueType>,
            physical_nodes: &mut usize,
            depth: usize,
        ) -> Result<FunctionTypeSummary> {
            *physical_nodes += 1;
            self.unique_nodes += 1;
            if *physical_nodes > 4096 || self.unique_nodes > 16_384 || depth > 64 {
                return Err(Diagnostic::new(
                    "CAPTION_BUDGET_EXCEEDED",
                    "expression",
                    "function DAG nodes or depth",
                ));
            }
            let (value_type, height) = match e {
                Expression::Literal { value_type, value } => {
                    typed_value(*value_type, value)?;
                    (*value_type, 0)
                }
                Expression::Read { path } => {
                    require_context_capability(path, self.scene)?;
                    let ty = if let Some(id) = path.strip_prefix("params.") {
                        self.scene.parameters.iter().find(|p| p.id == id).map(|p| p.value_type)
                    } else if let Some(id) = path.strip_prefix("args.") {
                        arguments.get(id).copied()
                    } else {
                        context_type(path)
                    };
                    (
                        ty.ok_or_else(|| Diagnostic::new("CAPTION_EXPRESSION_TYPE", path, "unknown context field"))?,
                        0,
                    )
                }
                Expression::If {
                    condition,
                    then,
                    otherwise,
                } => {
                    let condition = self.visit(condition, arguments, physical_nodes, depth + 1)?;
                    if condition.value_type != ValueType::Bool {
                        return Err(invalid("if", "boolean condition required"));
                    }
                    let yes = self.visit(then, arguments, physical_nodes, depth + 1)?;
                    let no = self.visit(otherwise, arguments, physical_nodes, depth + 1)?;
                    if yes.value_type != no.value_type {
                        return Err(invalid("if", "branch types differ"));
                    }
                    (yes.value_type, 1 + condition.height.max(yes.height).max(no.height))
                }
                Expression::Call { function, args } => {
                    let args = args
                        .iter()
                        .map(|arg| self.visit(arg, arguments, physical_nodes, depth + 1))
                        .collect::<Result<Vec<_>>>()?;
                    let types = args.iter().map(|arg| arg.value_type).collect::<Vec<_>>();
                    let argument_height = args.iter().map(|arg| arg.height).max().unwrap_or(0);
                    if let Some(ty) = builtin_type(function, &types) {
                        (ty, 1 + argument_height)
                    } else {
                        let scene = self.scene;
                        let f = scene.functions.iter().find(|f| f.id == *function).ok_or_else(|| {
                            Diagnostic::new("CAPTION_EXPRESSION_TYPE", function, "unknown function or invalid argument types")
                        })?;
                        if f.arguments.len() != types.len() || f.arguments.iter().zip(&types).any(|(arg, ty)| arg.value_type != *ty) {
                            return Err(invalid(function, "argument types differ"));
                        }
                        if self.visiting.contains(function) {
                            return Err(Diagnostic::new("CAPTION_DEPENDENCY_CYCLE", function, "recursive function"));
                        }
                        let summary = if let Some(summary) = self.memo.get(function) {
                            *summary
                        } else {
                            self.visiting.insert(function.clone());
                            let inner_args = f.arguments.iter().map(|arg| (arg.name.clone(), arg.value_type)).collect();
                            let checked = self.visit(&f.body, &inner_args, &mut 0, depth + 1);
                            self.visiting.remove(function);
                            let checked = checked?;
                            if checked.value_type != f.returns {
                                return Err(invalid(function, "return type differs"));
                            }
                            self.memo.insert(function.clone(), checked);
                            checked
                        };
                        (summary.value_type, 1 + argument_height.max(summary.height))
                    }
                }
            };
            // A cached body may be reached at a deeper call site than its first use.
            if depth + height > 64 {
                return Err(Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "expression", "function DAG call depth"));
            }
            Ok(FunctionTypeSummary { value_type, height })
        }
    }
    let mut checker = Checker {
        scene,
        memo: BTreeMap::new(),
        visiting: Default::default(),
        unique_nodes: 0,
    };
    Ok(checker.visit(expr, arguments, &mut 0, 0)?.value_type)
}

#[derive(Clone, Debug, Default)]
pub struct Context {
    pub fields: BTreeMap<String, Evaluated>,
    pub spans: BTreeMap<UnitKind, (f64, f64)>,
    pub seed: u64,
    pub stable_key: String,
}
#[derive(Debug)]
pub struct Budget {
    remaining: usize,
    permutations: BTreeMap<(usize, u32), Vec<u16>>,
    cached_indices: usize,
}
impl Default for Budget {
    fn default() -> Self {
        Self::new(MAX_OPERATIONS)
    }
}
impl Budget {
    pub fn new(limit: usize) -> Self {
        Self {
            remaining: limit,
            permutations: BTreeMap::new(),
            cached_indices: 0,
        }
    }
    pub fn remaining(&self) -> usize {
        self.remaining
    }
    pub fn spend(&mut self) -> Result<()> {
        self.spend_operations(1)
    }
    fn spend_operations(&mut self, count: usize) -> Result<()> {
        self.remaining = self
            .remaining
            .checked_sub(count)
            .ok_or_else(|| Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "frame", "operation budget"))?;
        Ok(())
    }
    fn shuffle_index(&mut self, index: f64, count: f64, seed: f64) -> Result<f64> {
        if !index.is_finite()
            || index.fract() != 0.0
            || !count.is_finite()
            || count.fract() != 0.0
            || !(1.0..=8192.0).contains(&count)
            || index < 0.0
            || index >= count
            || !seed.is_finite()
        {
            return Err(invalid(
                "shuffle-index",
                "integer index/count require 0 <= index < count <= 8192 and a finite seed",
            ));
        }
        let index = index as usize;
        let count = count as usize;
        // Floating-to-unsigned casts saturate; apply the specified wrapping before casting.
        let mut wrapped_seed = libm::fmod(libm::trunc(seed), 4_294_967_296.0);
        if wrapped_seed < 0.0 {
            wrapped_seed += 4_294_967_296.0;
        }
        let seed = wrapped_seed as u32;
        if let Some(values) = self.permutations.get(&(count, seed)) {
            return Ok(f64::from(values[index]));
        }
        // Charge both initialization and every swap before allocating or computing.
        self.spend_operations(count + count - 1)?;
        let mut values = (0..count as u16).collect::<Vec<_>>();
        let mut state = i64::from(seed);
        for current in (1..count).rev() {
            if state == 0 {
                state = 123_459_876;
            }
            state = 16_807 * (state % 127_773) - 2_836 * (state / 127_773);
            if state < 0 {
                state += 2_147_483_647;
            }
            let random = (state % 2_147_483_647) as f64 / 2_147_483_647.0;
            let selected = libm::floor(random * (current + 1) as f64) as usize;
            values.swap(current, selected);
        }
        let value = f64::from(values[index]);
        // The cache lives only in this budget. Capacity changes work, never output.
        if self.permutations.len() < 16 && self.cached_indices + count <= 16_384 {
            self.cached_indices += count;
            self.permutations.insert((count, seed), values);
        }
        Ok(value)
    }
}
pub fn evaluate(expr: &Expression, scene: &Scene, ctx: &Context, budget: &mut Budget) -> Result<Evaluated> {
    fn inner(e: &Expression, s: &Scene, c: &Context, a: &BTreeMap<String, Evaluated>, b: &mut Budget, depth: usize) -> Result<Evaluated> {
        b.spend()?;
        if depth > 64 {
            return Err(invalid("expression", "call depth exceeded"));
        }
        let value = match e {
            Expression::Literal { value_type, value } => typed_value(*value_type, value)?,
            Expression::Read { path } => {
                let v = if let Some(id) = path.strip_prefix("args.") {
                    a.get(id)
                } else {
                    c.fields.get(path)
                };
                v.cloned().ok_or_else(|| invalid(path, "context unavailable"))?
            }
            Expression::If {
                condition,
                then,
                otherwise,
            } => {
                let choice = inner(condition, s, c, a, b, depth + 1)?.boolean()?;
                inner(if choice { then } else { otherwise }, s, c, a, b, depth + 1)?
            }
            Expression::Call { function, args } => {
                let values = args.iter().map(|x| inner(x, s, c, a, b, depth + 1)).collect::<Result<Vec<_>>>()?;
                let types = values.iter().map(Evaluated::value_type).collect::<Vec<_>>();
                if let Some(t) = builtin_type(function, &types) {
                    if function == "shuffle-index" {
                        Evaluated::Number(t, b.shuffle_index(values[0].number()?, values[1].number()?, values[2].number()?)?)
                    } else {
                        builtin(function, &values, t, c)?
                    }
                } else {
                    let f = s
                        .functions
                        .iter()
                        .find(|f| f.id == *function)
                        .ok_or_else(|| invalid(function, "unknown function"))?;
                    let local = f.arguments.iter().zip(values).map(|(a, v)| (a.name.clone(), v)).collect();
                    inner(&f.body, s, c, &local, b, depth + 1)?
                }
            }
        };
        value.finite()
    }
    inner(expr, scene, ctx, &BTreeMap::new(), budget, 0)
}
fn random(seed: u64, key: &str, channel: u64) -> f64 {
    let mut h = seed ^ channel;
    for x in key.bytes() {
        h = (h ^ u64::from(x)).wrapping_mul(0x100000001b3);
    }
    h = h.wrapping_add(0x9e3779b97f4a7c15);
    h = (h ^ (h >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    h = (h ^ (h >> 27)).wrapping_mul(0x94d049bb133111eb);
    h ^= h >> 31;
    (h >> 11) as f64 * (1.0 / 9007199254740992.0)
}
fn builtin(name: &str, v: &[Evaluated], t: ValueType, c: &Context) -> Result<Evaluated> {
    use Evaluated::*;
    if name == "eq" {
        return Ok(Bool(v[0] == v[1]));
    }
    if name == "and" {
        return Ok(Bool(v[0].boolean()? && v[1].boolean()?));
    }
    if name == "or" {
        return Ok(Bool(v[0].boolean()? || v[1].boolean()?));
    }
    if name == "not" {
        return Ok(Bool(!v[0].boolean()?));
    }
    if name == "mix" && t == ValueType::Color {
        let (Color(a), Color(b)) = (&v[0], &v[1]) else { unreachable!() };
        let u = v[2].number()?;
        return Ok(Color(std::array::from_fn(|i| a[i] + (b[i] - a[i]) * u)));
    }
    let n = v.iter().map(Evaluated::number).collect::<Result<Vec<_>>>()?;
    if name == "lt" {
        return Ok(Bool(n[0] < n[1]));
    }
    if name == "gt" {
        return Ok(Bool(n[0] > n[1]));
    }
    let x = match name {
        "add" => n[0] + n[1],
        "sub" => n[0] - n[1],
        "mul" => n[0] * n[1],
        "div" => {
            if n[1] == 0.0 {
                return Err(invalid("div", "division by zero"));
            }
            n[0] / n[1]
        }
        "min" => n[0].min(n[1]),
        "max" => n[0].max(n[1]),
        "abs" => n[0].abs(),
        "floor" => libm::floor(n[0]),
        "ceil" => libm::ceil(n[0]),
        "sin" => libm::sin(n[0]),
        "cos" => libm::cos(n[0]),
        "phase" => n[0] * n[1] * std::f64::consts::TAU,
        "mix" => n[0] + (n[1] - n[0]) * n[2],
        "clamp" => {
            if n[1] > n[2] {
                return Err(invalid("clamp", "reversed limits"));
            }
            n[0].clamp(n[1], n[2])
        }
        "sqrt" => {
            if n[0] < 0.0 {
                return Err(invalid("sqrt", "negative argument"));
            }
            libm::sqrt(n[0])
        }
        "smoothstep" => {
            let u = n[0].clamp(0.0, 1.0);
            u * u * (3.0 - 2.0 * u)
        }
        "cubic-bezier" => {
            if !(0.0..=1.0).contains(&n[1]) || !(0.0..=1.0).contains(&n[3]) {
                return Err(invalid("cubic-bezier", "control point x must be in [0, 1]"));
            }
            motion::curve::cubic_bezier(n[1], n[2], n[3], n[4], n[0])
        }
        "random" => random(c.seed, &c.stable_key, n[0].to_bits()),
        "noise" => {
            let lo = libm::floor(n[0]);
            let u = n[0] - lo;
            let u = u * u * (3.0 - 2.0 * u);
            let a = random(c.seed, &c.stable_key, lo.to_bits());
            let z = random(c.seed, &c.stable_key, (lo + 1.0).to_bits());
            a + (z - a) * u
        }
        _ => return Err(invalid(name, "unsupported function")),
    };
    Number(t, x).finite()
}
pub fn sample_value(
    value: &DynamicValue,
    t: ValueType,
    scene: &Scene,
    ctx: &Context,
    seconds: f64,
    budget: &mut Budget,
) -> Result<Option<Evaluated>> {
    budget.spend()?;
    match value {
        DynamicValue::Constant { value } => Ok(Some(typed_value(t, value)?)),
        DynamicValue::Expression { expression } => Ok(Some(evaluate(expression, scene, ctx, budget)?)),
        DynamicValue::Keyframes {
            clock,
            keys,
            interpolation,
            fill,
        } => {
            let &(start, end) = ctx
                .spans
                .get(&clock.unit)
                .ok_or_else(|| invalid("clock", "unit time unavailable"))?;
            let origin = match clock.origin {
                Origin::Start => start,
                Origin::End => end,
            } + clock.offset.seconds()
                + ctx.fields.get("unit.index").map(|v| v.number()).transpose()?.unwrap_or(0.0) * clock.stagger.seconds();
            let duration = match clock.duration {
                Duration::Fixed { ticks, timescale } => ticks as f64 / timescale as f64,
                Duration::UnitSpan => end - start,
            };
            let mut u = if duration == 0.0 {
                if seconds < origin { -1.0 } else { 1.0 }
            } else {
                (seconds - origin) / duration
            };
            let mut repeating = false;
            if let Some(repeat) = clock.repeat {
                if duration <= 0.0 {
                    return Err(invalid("repeat", "positive duration required"));
                }
                if u >= repeat.iterations as f64 {
                    return if fill.after == FillMode::Hold {
                        let key = if repeat.mode == RepeatMode::Yoyo && repeat.iterations % 2 == 0 {
                            &keys[0]
                        } else {
                            keys.last().unwrap()
                        };
                        Ok(Some(typed_value(t, &key.value)?))
                    } else {
                        Ok(None)
                    };
                }
                if u >= 0.0 {
                    let cycle = libm::floor(u) as u32;
                    u -= cycle as f64;
                    if repeat.mode == RepeatMode::Yoyo && cycle % 2 == 1 {
                        u = 1.0 - u;
                    }
                    repeating = true;
                }
            }
            if u < keys[0].at {
                return if fill.before == FillMode::Hold {
                    Ok(Some(typed_value(t, &keys[0].value)?))
                } else {
                    Ok(None)
                };
            }
            if u >= keys.last().unwrap().at {
                return if fill.after == FillMode::Hold || (repeating && u == 1.0) {
                    Ok(Some(typed_value(t, &keys.last().unwrap().value)?))
                } else {
                    Ok(None)
                };
            }
            let i = keys.partition_point(|k| k.at <= u).saturating_sub(1);
            let (a, b) = (&keys[i], &keys[i + 1]);
            let mut p = (u - a.at) / (b.at - a.at);
            p = match interpolation {
                Interpolation::Linear => p,
                Interpolation::Step => 0.0,
                Interpolation::EaseOutQuad => motion::curve::apply_ease_id(motion::curve::EaseId::EaseOutQuad, p),
                Interpolation::CubicBezier { x1, y1, x2, y2 } => motion::curve::cubic_bezier(*x1, *y1, *x2, *y2, p),
            };
            let av = typed_value(t, &a.value)?;
            let bv = typed_value(t, &b.value)?;
            if *interpolation == Interpolation::Step {
                return Ok(Some(av));
            }
            Ok(Some(builtin("mix", &[av, bv, Evaluated::Number(ValueType::Scalar, p)], t, ctx)?))
        }
    }
}
