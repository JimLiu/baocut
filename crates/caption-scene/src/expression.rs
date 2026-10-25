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
    /// Resolved list parameter; expressions can only read it through `pick`.
    List(ValueType, Vec<Evaluated>),
}
impl Evaluated {
    pub fn value_type(&self) -> ValueType {
        match self {
            Self::Number(t, _) => *t,
            Self::Bool(_) => ValueType::Bool,
            Self::Color(_) => ValueType::Color,
            Self::List(t, _) => *t,
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
        if let Self::List(t, items) = self {
            return Ok(Self::List(t, items.into_iter().map(Evaluated::finite).collect::<Result<_>>()?));
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
/// Static slots of `caption-page-line-context/1`: `<field>.<k>` reads line `k` of the current page.
pub const PAGE_LINE_SLOTS: usize = 16;
const PAGE_LINE_FIELDS: [&str; 3] = ["layout.pageLineBoxX", "layout.pageLineBoxWidth", "unit.pageLineGraphemeCount"];
/// Splits a page line read into its field and zero-based slot; slots are canonical decimals below `PAGE_LINE_SLOTS`.
pub fn page_line_slot(path: &str) -> Option<(&'static str, usize)> {
    PAGE_LINE_FIELDS.iter().find_map(|field| {
        let slot = path.strip_prefix(field)?.strip_prefix('.')?;
        let canonical =
            !slot.is_empty() && slot.len() <= 2 && slot.bytes().all(|b| b.is_ascii_digit()) && (slot == "0" || !slot.starts_with('0'));
        let slot = slot.parse::<usize>().ok().filter(|k| canonical && *k < PAGE_LINE_SLOTS)?;
        Some((*field, slot))
    })
}
pub fn context_type(path: &str) -> Option<ValueType> {
    if let Some((field, _)) = page_line_slot(path) {
        return Some(if field.starts_with("unit.") {
            ValueType::Scalar
        } else {
            ValueType::Length
        });
    }
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
        | "time.inputFirstWordStartSeconds"
        | "time.inputFirstWordEndSeconds"
        | "time.inputLastWordStartSeconds"
        | "time.inputLastWordEndSeconds"
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
        | "unit.pageTag"
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
        "unit.referenceInkAvailable"
        | "unit.labelInkAvailable"
        | "unit.active"
        | "unit.read"
        | "unit.unread"
        | "unit.pageLastWordTimed"
        | "unit.cueFirstWordTimed"
        | "unit.inputFirstWordTimed"
        | "unit.inputLastWordTimed"
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
        | "unit.previousWordInLine"
        | "cue.speechPhase.beforeFirst"
        | "cue.speechPhase.reading"
        | "cue.speechPhase.afterLast"
        | "cue.speechPhase.estimated"
        | "word.inSpan" => ValueType::Bool,
        "material.surfaceX"
        | "material.surfaceY"
        | "material.surfaceWidth"
        | "material.surfaceHeight"
        | "layout.referenceInkX"
        | "layout.referenceInkY"
        | "layout.referenceInkWidth"
        | "layout.referenceInkHeight"
        | "layout.labelWidth"
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
    let capability = if matches!(
        path,
        "layout.referenceInkX"
            | "layout.referenceInkY"
            | "layout.referenceInkWidth"
            | "layout.referenceInkHeight"
            | "unit.referenceInkAvailable"
    ) {
        Some("caption-reference-geometry/1")
    } else if matches!(
        path,
        "material.surfaceX" | "material.surfaceY" | "material.surfaceWidth" | "material.surfaceHeight"
    ) {
        Some("caption-layer-capture/1")
    } else {
        None
    };
    if let Some(capability) = capability {
        if !scene.required_capabilities.iter().any(|value| value == capability) {
            return Err(Diagnostic::new(
                "CAPTION_CAPABILITY_UNAVAILABLE",
                path,
                format!("{capability} must be declared"),
            ));
        }
    }
    if matches!(
        path,
        "time.inputFirstWordStartSeconds"
            | "time.inputFirstWordEndSeconds"
            | "time.inputLastWordStartSeconds"
            | "time.inputLastWordEndSeconds"
            | "unit.inputFirstWordTimed"
            | "unit.inputLastWordTimed"
    ) && !scene.required_capabilities.iter().any(|c| c == "caption-layout-clock/1")
    {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_UNAVAILABLE",
            path,
            "caption-layout-clock/1 must be declared",
        ));
    }

    if path == "unit.pageTag" {
        if !scene.required_capabilities.iter().any(|c| c == "caption-page-tag/1") {
            return Err(Diagnostic::new(
                "CAPTION_CAPABILITY_UNAVAILABLE",
                path,
                "caption-page-tag/1 must be declared",
            ));
        }
        if scene.layout.pagination.page_tags.is_none() {
            return Err(Diagnostic::new("CAPTION_SCENE_INVALID", path, "pagination.pageTags required"));
        }
    }
    if let Some((_, slot)) = page_line_slot(path) {
        if !scene.required_capabilities.iter().any(|c| c == "caption-page-line-context/1") {
            return Err(Diagnostic::new(
                "CAPTION_CAPABILITY_UNAVAILABLE",
                path,
                "caption-page-line-context/1 must be declared",
            ));
        }
        if slot >= scene.layout.max_lines {
            return Err(Diagnostic::new(
                "CAPTION_EXPRESSION_TYPE",
                path,
                "page line slot is not below maxLines",
            ));
        }
    }
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
    if matches!(
        path,
        "cue.speechPhase.beforeFirst"
            | "cue.speechPhase.reading"
            | "cue.speechPhase.afterLast"
            | "cue.speechPhase.estimated"
            | "word.inSpan"
    ) && !scene.required_capabilities.iter().any(|c| c == "caption-speech-phase/1")
    {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_UNAVAILABLE",
            path,
            "caption-speech-phase/1 must be declared",
        ));
    }
    Ok(())
}
fn precondition_enabled(scene: &Scene) -> bool {
    scene
        .required_capabilities
        .iter()
        .any(|cap| cap == "caption-expression-precondition/1")
}
fn scene_builtin_type(name: &str, arguments: &[ValueType], scene: &Scene) -> Option<ValueType> {
    if name == "require" && !precondition_enabled(scene) {
        None
    } else {
        builtin_type(name, arguments)
    }
}
fn require_function_capability(function: &str, scene: &Scene) -> Result<()> {
    if function == "require" && !precondition_enabled(scene) && !scene.functions.iter().any(|value| value.id == "require") {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_REQUIRED",
            function,
            "caption-expression-precondition/1 must be declared",
        ));
    }
    let capability = match function {
        "exp" => "caption-exponential-expression/1",
        "round" => "caption-rounding-expression/1",
        "mod" | "fract" => "caption-modular-expression/1",
        "pow" => "caption-power-expression/1",
        "pick" => "caption-list-pick/1",
        _ => return Ok(()),
    };
    if !scene.required_capabilities.iter().any(|c| c == capability) {
        return Err(Diagnostic::new(
            "CAPTION_CAPABILITY_UNAVAILABLE",
            function,
            format!("{capability} must be declared"),
        ));
    }
    Ok(())
}
/// Scalar parameter type for `params.<id>`; list parameters are only readable through `pick`.
fn parameter_read_type(path: &str, id: &str, scene: &Scene) -> Result<Option<ValueType>> {
    match scene.parameters.iter().find(|p| p.id == id) {
        Some(p) if p.list => Err(Diagnostic::new(
            "CAPTION_EXPRESSION_TYPE",
            path,
            "list parameter is only readable through pick",
        )),
        p => Ok(p.map(|p| p.value_type)),
    }
}
/// `pick(params.<list>, index)`: the first argument must name a declared list parameter.
fn pick_list<'a>(args: &'a [Expression], scene: &Scene) -> Result<&'a str> {
    let [Expression::Read { path }, _] = args else {
        return Err(Diagnostic::new(
            "CAPTION_EXPRESSION_TYPE",
            "pick",
            "pick requires a list parameter read and one index",
        ));
    };
    match path
        .strip_prefix("params.")
        .and_then(|id| scene.parameters.iter().find(|p| p.id == id))
    {
        Some(p) if p.list => Ok(path),
        _ => Err(Diagnostic::new(
            "CAPTION_EXPRESSION_TYPE",
            path,
            "pick requires a declared list parameter",
        )),
    }
}
fn pick_type(path: &str, index: ValueType, scene: &Scene) -> Result<ValueType> {
    if !matches!(index, ValueType::Scalar | ValueType::Integer) {
        return Err(Diagnostic::new(
            "CAPTION_EXPRESSION_TYPE",
            "pick",
            "index must be scalar or integer",
        ));
    }
    let id = &path["params.".len()..];
    Ok(scene
        .parameters
        .iter()
        .find(|p| p.id == id)
        .expect("checked list parameter")
        .value_type)
}
/// Floored modulo: the result takes the divisor's sign and stays in `[0, b)` / `(b, 0]`.
fn floored_mod(a: f64, b: f64) -> Result<f64> {
    if b == 0.0 {
        return Err(invalid("mod", "zero divisor"));
    }
    let mut r = libm::fmod(a, b);
    if r != 0.0 && (r < 0.0) != (b < 0.0) {
        r += b;
    }
    // A tiny opposite-signed remainder can round up to the divisor itself.
    Ok(if r == b { 0.0 } else { r })
}
pub fn builtin_type(name: &str, args: &[ValueType]) -> Option<ValueType> {
    use ValueType::*;
    let numeric = |t| matches!(t, Scalar | Integer | Length | Time | Angle);
    match (name, args) {
        ("require", [Bool, value]) => Some(*value),
        ("add" | "sub" | "min" | "max", [a, b]) if a == b && numeric(*a) => Some(*a),
        ("mul", [Scalar, Integer] | [Integer, Scalar]) => Some(Scalar),
        ("div", [Integer, Scalar | Integer]) => Some(Scalar),
        ("mix", [Integer, Integer, Scalar]) => Some(Scalar),
        ("mul", [Scalar | Integer, b]) | ("mul", [b, Scalar | Integer]) if numeric(*b) => Some(*b),
        ("div", [a, Scalar | Integer]) if numeric(*a) => Some(*a),
        ("div", [a, b]) if a == b && numeric(*a) => Some(Scalar),
        ("abs", [a]) if numeric(*a) => Some(*a),
        ("floor" | "ceil" | "round" | "fract", [Scalar]) => Some(Scalar),
        ("mod" | "pow", [Scalar, Scalar]) => Some(Scalar),
        ("sin" | "cos", [Angle]) => Some(Scalar),
        ("phase", [Time, Scalar]) => Some(Angle),
        ("mix", [a, b, Scalar]) if a == b && (numeric(*a) || *a == Color) => Some(*a),
        ("clamp", [a, b, c]) if a == b && b == c && numeric(*a) => Some(*a),
        ("smoothstep" | "sqrt" | "exp", [Scalar]) => Some(Scalar),
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
                    parameter_read_type(path, id, s)?
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
                require_function_capability(function, s)?;
                if function == "pick" {
                    let list = pick_list(args, s)?;
                    let index = inner(&args[1], s, a, stack, budget)?;
                    return pick_type(list, index, s);
                }
                let ts = args.iter().map(|x| inner(x, s, a, stack, budget)).collect::<Result<Vec<_>>>()?;
                if function == "require" && precondition_enabled(s) && !matches!(ts.as_slice(), [ValueType::Bool, _]) {
                    return Err(Diagnostic::new(
                        "CAPTION_EXPRESSION_TYPE",
                        function,
                        "boolean condition and one value required",
                    ));
                }
                if let Some(t) = scene_builtin_type(function, &ts, s) {
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
                        parameter_read_type(path, id, self.scene)?
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
                Expression::Call { function, args } if function == "pick" => {
                    require_function_capability(function, self.scene)?;
                    let list = pick_list(args, self.scene)?;
                    *physical_nodes += 1;
                    self.unique_nodes += 1;
                    let index = self.visit(&args[1], arguments, physical_nodes, depth + 1)?;
                    (pick_type(list, index.value_type, self.scene)?, 1 + index.height)
                }
                Expression::Call { function, args } => {
                    require_function_capability(function, self.scene)?;
                    let args = args
                        .iter()
                        .map(|arg| self.visit(arg, arguments, physical_nodes, depth + 1))
                        .collect::<Result<Vec<_>>>()?;
                    let types = args.iter().map(|arg| arg.value_type).collect::<Vec<_>>();
                    let argument_height = args.iter().map(|arg| arg.height).max().unwrap_or(0);
                    if function == "require" && precondition_enabled(self.scene) && !matches!(types.as_slice(), [ValueType::Bool, _]) {
                        return Err(Diagnostic::new(
                            "CAPTION_EXPRESSION_TYPE",
                            function,
                            "boolean condition and one value required",
                        ));
                    }
                    if let Some(ty) = scene_builtin_type(function, &types, self.scene) {
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
    image_paint_pixels: usize,
    image_phase_slots: usize,
    image_paint_work: u64,
    paint_mask_work: u64,
    glyph_distance_work: u64,
    extended_paint_stack: bool,
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
            image_paint_pixels: 0,
            image_phase_slots: 0,
            image_paint_work: 0,
            paint_mask_work: 0,
            glyph_distance_work: 0,
            extended_paint_stack: false,
        }
    }
    /// Shared across all recorded cue/layer image paints in this frame.
    pub fn reserve_image_paint_pixels(&mut self, count: usize) -> Result<()> {
        let next = self
            .image_paint_pixels
            .checked_add(count)
            .filter(|total| *total <= 16 * 1024 * 1024)
            .ok_or_else(|| Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "frame", "image paint surfaces"))?;
        self.image_paint_pixels = next;
        Ok(())
    }
    /// Source-scalar maps are independent of prepared glyph counts: whitespace
    /// can take map slots even when it produces no visible glyph.
    pub fn reserve_image_phase_slots(&mut self, count: usize) -> Result<()> {
        let next = self
            .image_phase_slots
            .checked_add(count)
            .filter(|total| *total <= 131_072)
            .ok_or_else(|| Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "frame", "image phase scalar maps"))?;
        self.image_phase_slots = next;
        Ok(())
    }
    /// Image sample/gradient work and each Gaussian channel tap share one frame cap.
    pub fn reserve_image_paint_work(&mut self, count: u64) -> Result<()> {
        let next = self
            .image_paint_work
            .checked_add(count)
            .filter(|total| *total <= 256 * 1024 * 1024)
            .ok_or_else(|| Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "frame", "image paint sampling work"))?;
        self.image_paint_work = next;
        Ok(())
    }
    /// Opt-in frame scope; retained across cue, history and material recording.
    pub fn enable_extended_paint_stack(&mut self) {
        self.extended_paint_stack = true;
    }
    pub fn extended_paint_stack_enabled(&self) -> bool {
        self.extended_paint_stack
    }
    /// Extended stacks share existing image surface and sample caps. The whole
    /// reservation is atomic; callers must not charge captured pixels again.
    pub fn reserve_extended_paint_surface(&mut self, pixels: usize, work: u64) -> Result<()> {
        if !self.extended_paint_stack {
            return Ok(());
        }
        let pixels = self
            .image_paint_pixels
            .checked_add(pixels)
            .filter(|total| *total <= 16 * 1024 * 1024)
            .ok_or_else(|| Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "frame", "extended paint surfaces"))?;
        let work = self
            .image_paint_work
            .checked_add(work)
            .filter(|total| *total <= 256 * 1024 * 1024)
            .ok_or_else(|| Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "frame", "extended paint sampling work"))?;
        self.image_paint_pixels = pixels;
        self.image_paint_work = work;
        Ok(())
    }
    pub fn remaining(&self) -> usize {
        self.remaining
    }
    /// Content and alpha-matte canvas work share one cap across the frame.
    pub fn reserve_paint_mask_work(&mut self, count: u64) -> Result<()> {
        self.reserve_paint_mask_rasters(count, 0, 0)
    }
    /// Atomically reserve mask work, cropped raster storage and transfer work.
    /// Local masks share the existing image-paint frame caps even without an
    /// extended paint stack. Failed preflight leaves every counter unchanged.
    pub fn reserve_paint_mask_rasters(&mut self, count: u64, pixels: usize, work: u64) -> Result<()> {
        let next = self
            .paint_mask_work
            .checked_add(count)
            .filter(|total| *total <= 128 * 1024 * 1024)
            .ok_or_else(|| Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "frame", "paint mask work"))?;
        let pixels = self
            .image_paint_pixels
            .checked_add(pixels)
            .filter(|total| *total <= 16 * 1024 * 1024)
            .ok_or_else(|| Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "frame", "paint mask surfaces"))?;
        let work = self
            .image_paint_work
            .checked_add(work)
            .filter(|total| *total <= 256 * 1024 * 1024)
            .ok_or_else(|| Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "frame", "paint mask transfer work"))?;
        self.paint_mask_work = next;
        self.image_paint_pixels = pixels;
        self.image_paint_work = work;
        Ok(())
    }
    /// Contour-segment and distance-sample work has its own frame-wide cap.
    /// Rejected reservations do not consume this or any existing paint budget.
    pub fn reserve_glyph_distance_work(&mut self, count: u64) -> Result<()> {
        let next = self
            .glyph_distance_work
            .checked_add(count)
            .filter(|total| *total <= 128 * 1024 * 1024)
            .ok_or_else(|| Diagnostic::new("CAPTION_BUDGET_EXCEEDED", "frame", "glyph distance work"))?;
        self.glyph_distance_work = next;
        Ok(())
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
                if path.starts_with("layout.referenceInk") || path == "unit.referenceInkAvailable" || path.starts_with("material.surface") {
                    require_context_capability(path, s)?;
                }
                let v = if let Some(id) = path.strip_prefix("args.") {
                    a.get(id)
                } else {
                    c.fields.get(path)
                };
                if let Some(Evaluated::List(..)) = v {
                    return Err(Diagnostic::new(
                        "CAPTION_EXPRESSION_TYPE",
                        path,
                        "list parameter is only readable through pick",
                    ));
                }
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
                require_function_capability(function, s)?;
                if function == "pick" {
                    let list = pick_list(args, s)?;
                    b.spend()?;
                    let Some(Evaluated::List(_, items)) = c.fields.get(list) else {
                        return Err(invalid(list, "context unavailable"));
                    };
                    let index = inner(&args[1], s, c, a, b, depth + 1)?.number()?;
                    if !index.is_finite() || index.fract() != 0.0 || items.is_empty() {
                        return Err(invalid("pick", "finite integer index and nonempty list required"));
                    }
                    return items[index.rem_euclid(items.len() as f64) as usize].clone().finite();
                }
                if function == "require" && precondition_enabled(s) {
                    let [condition, value] = args.as_slice() else {
                        return Err(invalid("require", "boolean condition and one value required"));
                    };
                    if !inner(condition, s, c, a, b, depth + 1)?.boolean()? {
                        return Err(Diagnostic::new(
                            "CAPTION_PRECONDITION_FAILED",
                            "require",
                            "expression precondition was not met",
                        ));
                    }
                    return inner(value, s, c, a, b, depth + 1);
                }
                let values = args.iter().map(|x| inner(x, s, c, a, b, depth + 1)).collect::<Result<Vec<_>>>()?;
                let types = values.iter().map(Evaluated::value_type).collect::<Vec<_>>();
                if let Some(t) = scene_builtin_type(function, &types, s) {
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
/// Seeded unit value in `[0, 1)`; the same hash as the `random` builtin, exposed
/// for preparation-time choices such as `pagination.patternSelect`.
pub fn seeded_unit(seed: u64, key: &str, channel: u64) -> f64 {
    random(seed, key, channel)
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
        // libm::round rounds halfway cases away from zero.
        "round" => libm::round(n[0]),
        "mod" => floored_mod(n[0], n[1])?,
        "fract" => floored_mod(n[0], 1.0)?,
        "pow" => {
            if n[0] < 0.0 && n[1].fract() != 0.0 {
                return Err(invalid("pow", "negative base requires an integer exponent"));
            }
            libm::pow(n[0], n[1])
        }
        "sin" => libm::sin(n[0]),
        "cos" => libm::cos(n[0]),
        "exp" => libm::exp(n[0]),
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
    // All channels on a remapped cue, including material keyframes, share its
    // sampled clock. Callers may still pass timeline time for capture ordering.
    let seconds = if scene.layout.clock.is_some() {
        let start = ctx
            .spans
            .get(&UnitKind::Cue)
            .ok_or_else(|| invalid("layout.clock", "cue span unavailable"))?
            .0;
        start
            + ctx
                .fields
                .get("time.seconds")
                .ok_or_else(|| invalid("layout.clock", "sample context unavailable"))?
                .number()?
    } else {
        seconds
    };
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
            match clock.tail {
                ClockTail::None => {}
                ClockTail::Clamp => u = u.min(1.0),
                ClockTail::Repeat => {
                    if duration <= 0.0 {
                        return Err(invalid("tail", "positive duration required"));
                    }
                    let elapsed = seconds - origin;
                    if elapsed >= 0.0 {
                        // Floored remainder of the elapsed time keeps exact period ends at 0.
                        u = (floored_mod(elapsed, duration)? / duration).min(1.0 - f64::EPSILON / 2.0);
                    }
                }
            }
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
