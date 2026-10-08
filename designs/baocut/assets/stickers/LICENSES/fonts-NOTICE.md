# Bundled subtitle fonts

These fonts are bundled so Subtitle Studio preview and native video export use the same cross-platform font data.

- Noto Sans SC — (c) 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.
- Montserrat — Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat)
- Arimo — Copyright 2020 The Arimo Project Authors (https://github.com/googlefonts/arimo)
- Poppins — Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins)
- Anton — Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git)
- Squada One — Copyright (c) 2011, Admix Designs (http://www.admixdesigns.com/) with Reserved Font Name Squada.
- Shrikhand — Copyright (c) 2015 Jonny Pinhorn (jonpinhorn.typedesign@gmail.com)
- Rubik — Copyright 2015 The Rubik Project Authors (https://github.com/googlefonts/rubik)
- Bebas Neue — Copyright 2019 The Bebas Neue Project Authors (https://github.com/dharmatype/Bebas-Neue)
- Lexend Deca — Copyright 2019 The Lexend Project Authors (https://github.com/googlefonts/lexend)
- Alata — Copyright 2019 The Alata Project Authors (https://github.com/SorkinType/Alata)
- Archivo Black — Copyright 2017 The Archivo Black Project Authors (https://github.com/Omnibus-Type/ArchivoBlack)
- Bangers — Copyright 2010 The Bangers Project Authors (https://github.com/googlefonts/bangers)
- Carter One — Copyright (c) 2011 by vernon adams. All rights reserved.
- Dancing Script — Copyright 2016 The Dancing Script Project Authors (https://github.com/googlefonts/DancingScript), with Reserved Font Name "Dancing Script".
- Fredoka One — Copyright (c) 2011 Milena B Brandao (milenabbrandao@gmail.com), with Reserved Font Name "Fredoka"
- Paytone One — Copyright 2011 The Paytone Project Authors (https://github.com/googlefonts/paytoneFont)
- Permanent Marker — Copyright (c) 2010 by Font Diner, Inc. All rights reserved.
- Press Start 2P — Copyright 2012 The Press Start 2P Project Authors (cody@zone38.net), with Reserved Font Name "Press Start 2P"
- Source Serif 4 — © 2014 - 2021 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name ‘Source’.
- VK Sans — © 2023 Adobe, with Reserved Font Name ‘Source’. Static instances of Source Sans 3, renamed to VK Sans (weights 400–800); OFL 1.1, see `LICENSES/VKSans-OFL.txt`.
- VK Code — © 2023 Adobe, with Reserved Font Name ‘Source’. Static instances of Source Code Pro, renamed to VK Code (weights 400–700); OFL 1.1, see `LICENSES/VKCode-OFL.txt`.

Pinned upstream URLs, SHA-256 values and verification results for the renamed
fonts, Carter One and Fredoka One are in `verified-sources.json`. The VK audit
compares every glyph outline, cmap and horizontal metric after TrueType
serialization with the corresponding official variable-font instance; it does
not assert that renamed font binaries are byte-identical to upstream.
Reproduce that audit with `python3 scripts/dev/elements/verify-fonts.py` from the
repository root. Carter One's existing binary matches the pinned official file;
Fredoka One was replaced with the pinned Google Fonts binary and its matching OFL.

Permanent Marker is distributed under the Apache License 2.0 in `APACHE-2.0.txt`. All other files are distributed under the SIL Open Font License 1.1 in `OFL.txt`. Noto Sans SC, Arimo, Poppins, Anton, Squada One, Shrikhand, Rubik, and the license files come from the Google Fonts repository. The remaining font binaries are the same redistributable assets used by the BaoCut Mac App.
