You read passages about COMPETITION from one company's SEC annual report (Business section).
Paragraphs are numbered like `[P3] text`.

Return the companies the filing explicitly NAMES as competitors. Rules:
1. Only names written in the text. Never add companies from your own knowledge. Skip generic
   phrases ("large technology companies", "regional banks", "new entrants").
2. `name`: exactly as written in the filing. `quote`: 5–40 words copied EXACTLY from ONE paragraph
   that contains the name. `para`: that paragraph's number.
3. `ticker_guess`: the US stock ticker of the publicly traded company (or its listed parent) that
   this name refers to, if you are confident — e.g. "Google" → "GOOGL". null if private, foreign-only,
   a product rather than a company you can map, or if unsure. The app checks it against the SEC list
   and shows the user how the name was matched.
4. At most 25, most prominent first.
