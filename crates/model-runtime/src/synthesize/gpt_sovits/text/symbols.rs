//! GPT-SoVITS v2 音素符号表。
//!
//! 由 v2 仓库（`baocut-app`）的 `scripts/dev/gpt-sovits-text/gen_data.py` 从上游 `GPT_SoVITS/text/symbols2.py`（RVC-Boss/GPT-SoVITS@48b1a0169a28）生成，勿手改。

use std::collections::HashMap;
use std::sync::LazyLock;

/// v2 符号表，下标即 id（共 732 个）。
pub const SYMBOLS: &[&str] = &[
    "!", ",", "-", ".", "?", "AA", "AA0", "AA1", "AA2", "AE0", "AE1", "AE2", "AH0", "AH1", "AH2", "AO0", "AO1", "AO2", "AW0", "AW1", "AW2",
    "AY0", "AY1", "AY2", "B", "CH", "D", "DH", "E1", "E2", "E3", "E4", "E5", "EE", "EH0", "EH1", "EH2", "ER", "ER0", "ER1", "ER2", "EY0",
    "EY1", "EY2", "En1", "En2", "En3", "En4", "En5", "F", "G", "HH", "I", "IH", "IH0", "IH1", "IH2", "IY0", "IY1", "IY2", "JH", "K", "L",
    "M", "N", "NG", "OO", "OW0", "OW1", "OW2", "OY0", "OY1", "OY2", "P", "R", "S", "SH", "SP", "SP2", "SP3", "T", "TH", "U", "UH0", "UH1",
    "UH2", "UNK", "UW0", "UW1", "UW2", "V", "W", "Y", "Z", "ZH", "_", "a", "a1", "a2", "a3", "a4", "a5", "ai1", "ai2", "ai3", "ai4", "ai5",
    "an1", "an2", "an3", "an4", "an5", "ang1", "ang2", "ang3", "ang4", "ang5", "ao1", "ao2", "ao3", "ao4", "ao5", "b", "by", "c", "ch",
    "cl", "d", "dy", "e", "e1", "e2", "e3", "e4", "e5", "ei1", "ei2", "ei3", "ei4", "ei5", "en1", "en2", "en3", "en4", "en5", "eng1",
    "eng2", "eng3", "eng4", "eng5", "er1", "er2", "er3", "er4", "er5", "f", "g", "gy", "h", "hy", "i", "i01", "i02", "i03", "i04", "i05",
    "i1", "i2", "i3", "i4", "i5", "ia1", "ia2", "ia3", "ia4", "ia5", "ian1", "ian2", "ian3", "ian4", "ian5", "iang1", "iang2", "iang3",
    "iang4", "iang5", "iao1", "iao2", "iao3", "iao4", "iao5", "ie1", "ie2", "ie3", "ie4", "ie5", "in1", "in2", "in3", "in4", "in5", "ing1",
    "ing2", "ing3", "ing4", "ing5", "iong1", "iong2", "iong3", "iong4", "iong5", "ir1", "ir2", "ir3", "ir4", "ir5", "iu1", "iu2", "iu3",
    "iu4", "iu5", "j", "k", "ky", "l", "m", "my", "n", "ny", "o", "o1", "o2", "o3", "o4", "o5", "ong1", "ong2", "ong3", "ong4", "ong5",
    "ou1", "ou2", "ou3", "ou4", "ou5", "p", "py", "q", "r", "ry", "s", "sh", "t", "ts", "u", "u1", "u2", "u3", "u4", "u5", "ua1", "ua2",
    "ua3", "ua4", "ua5", "uai1", "uai2", "uai3", "uai4", "uai5", "uan1", "uan2", "uan3", "uan4", "uan5", "uang1", "uang2", "uang3",
    "uang4", "uang5", "ui1", "ui2", "ui3", "ui4", "ui5", "un1", "un2", "un3", "un4", "un5", "uo1", "uo2", "uo3", "uo4", "uo5", "v", "v1",
    "v2", "v3", "v4", "v5", "van1", "van2", "van3", "van4", "van5", "ve1", "ve2", "ve3", "ve4", "ve5", "vn1", "vn2", "vn3", "vn4", "vn5",
    "w", "x", "y", "z", "zh", "…", "[", "]", "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ",
    "ㅋ", "ㅌ", "ㅍ", "ㅎ", "ㅏ", "ㅐ", "ㅓ", "ㅔ", "ㅗ", "ㅜ", "ㅡ", "ㅣ", "停", "空", "Ya", "Ya1", "Ya2", "Ya3", "Ya4", "Ya5", "Ya6",
    "Yaa", "Yaa1", "Yaa2", "Yaa3", "Yaa4", "Yaa5", "Yaa6", "Yaai1", "Yaai2", "Yaai3", "Yaai4", "Yaai5", "Yaai6", "Yaak1", "Yaak2", "Yaak3",
    "Yaak4", "Yaak5", "Yaak6", "Yaam1", "Yaam2", "Yaam3", "Yaam4", "Yaam5", "Yaam6", "Yaan1", "Yaan2", "Yaan3", "Yaan4", "Yaan5", "Yaan6",
    "Yaang1", "Yaang2", "Yaang3", "Yaang4", "Yaang5", "Yaang6", "Yaap1", "Yaap2", "Yaap3", "Yaap4", "Yaap5", "Yaap6", "Yaat1", "Yaat2",
    "Yaat3", "Yaat4", "Yaat5", "Yaat6", "Yaau1", "Yaau2", "Yaau3", "Yaau4", "Yaau5", "Yaau6", "Yai", "Yai1", "Yai2", "Yai3", "Yai4",
    "Yai5", "Yai6", "Yak", "Yak1", "Yak2", "Yak3", "Yak4", "Yak5", "Yak6", "Yam1", "Yam2", "Yam3", "Yam4", "Yam5", "Yam6", "Yan1", "Yan2",
    "Yan3", "Yan4", "Yan5", "Yan6", "Yang1", "Yang2", "Yang3", "Yang4", "Yang5", "Yang6", "Yap1", "Yap2", "Yap3", "Yap4", "Yap5", "Yap6",
    "Yat1", "Yat2", "Yat3", "Yat4", "Yat5", "Yat6", "Yau", "Yau1", "Yau2", "Yau3", "Yau4", "Yau5", "Yau6", "Yb", "Yc", "Yd", "Ye", "Ye1",
    "Ye2", "Ye3", "Ye4", "Ye5", "Ye6", "Yei1", "Yei2", "Yei3", "Yei4", "Yei5", "Yei6", "Yek1", "Yek2", "Yek3", "Yek4", "Yek5", "Yek6",
    "Yeng1", "Yeng2", "Yeng3", "Yeng4", "Yeng5", "Yeng6", "Yeoi1", "Yeoi2", "Yeoi3", "Yeoi4", "Yeoi5", "Yeoi6", "Yeon1", "Yeon2", "Yeon3",
    "Yeon4", "Yeon5", "Yeon6", "Yeot1", "Yeot2", "Yeot3", "Yeot4", "Yeot5", "Yeot6", "Yf", "Yg", "Yg1", "Yg2", "Yg3", "Yg4", "Yg5", "Yg6",
    "Ygw", "Yh", "Yi1", "Yi2", "Yi3", "Yi4", "Yi5", "Yi6", "Yik1", "Yik2", "Yik3", "Yik4", "Yik5", "Yik6", "Yim1", "Yim2", "Yim3", "Yim4",
    "Yim5", "Yim6", "Yin1", "Yin2", "Yin3", "Yin4", "Yin5", "Yin6", "Ying1", "Ying2", "Ying3", "Ying4", "Ying5", "Ying6", "Yip1", "Yip2",
    "Yip3", "Yip4", "Yip5", "Yip6", "Yit1", "Yit2", "Yit3", "Yit4", "Yit5", "Yit6", "Yiu1", "Yiu2", "Yiu3", "Yiu4", "Yiu5", "Yiu6", "Yj",
    "Yk", "Yk1", "Yk2", "Yk3", "Yk4", "Yk5", "Yk6", "Ykw", "Yl", "Ym", "Ym1", "Ym2", "Ym3", "Ym4", "Ym5", "Ym6", "Yn", "Yn1", "Yn2", "Yn3",
    "Yn4", "Yn5", "Yn6", "Yng", "Yo", "Yo1", "Yo2", "Yo3", "Yo4", "Yo5", "Yo6", "Yoe1", "Yoe2", "Yoe3", "Yoe4", "Yoe5", "Yoe6", "Yoek1",
    "Yoek2", "Yoek3", "Yoek4", "Yoek5", "Yoek6", "Yoeng1", "Yoeng2", "Yoeng3", "Yoeng4", "Yoeng5", "Yoeng6", "Yoi", "Yoi1", "Yoi2", "Yoi3",
    "Yoi4", "Yoi5", "Yoi6", "Yok", "Yok1", "Yok2", "Yok3", "Yok4", "Yok5", "Yok6", "Yon", "Yon1", "Yon2", "Yon3", "Yon4", "Yon5", "Yon6",
    "Yong1", "Yong2", "Yong3", "Yong4", "Yong5", "Yong6", "Yot1", "Yot2", "Yot3", "Yot4", "Yot5", "Yot6", "You", "You1", "You2", "You3",
    "You4", "You5", "You6", "Yp", "Yp1", "Yp2", "Yp3", "Yp4", "Yp5", "Yp6", "Ys", "Yt", "Yt1", "Yt2", "Yt3", "Yt4", "Yt5", "Yt6", "Yu1",
    "Yu2", "Yu3", "Yu4", "Yu5", "Yu6", "Yui1", "Yui2", "Yui3", "Yui4", "Yui5", "Yui6", "Yuk", "Yuk1", "Yuk2", "Yuk3", "Yuk4", "Yuk5",
    "Yuk6", "Yun1", "Yun2", "Yun3", "Yun4", "Yun5", "Yun6", "Yung1", "Yung2", "Yung3", "Yung4", "Yung5", "Yung6", "Yut1", "Yut2", "Yut3",
    "Yut4", "Yut5", "Yut6", "Yw", "Yyu1", "Yyu2", "Yyu3", "Yyu4", "Yyu5", "Yyu6", "Yyun1", "Yyun2", "Yyun3", "Yyun4", "Yyun5", "Yyun6",
    "Yyut1", "Yyut2", "Yyut3", "Yyut4", "Yyut5", "Yyut6", "Yz",
];

static SYMBOL_IDS: LazyLock<HashMap<&'static str, u32>> =
    LazyLock::new(|| SYMBOLS.iter().enumerate().map(|(i, s)| (*s, i as u32)).collect());

/// 符号 → id；不在表内返回 `None`。
pub fn symbol_id(s: &str) -> Option<u32> {
    SYMBOL_IDS.get(s).copied()
}
