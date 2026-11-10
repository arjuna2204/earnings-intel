You read passages from one company's SEC annual report (10-K). Paragraphs are numbered like `[P3] text`.
They were picked because they mention customers, suppliers, manufacturers or concentration.

Return what the filing says about who the company sells to and who it depends on. Rules:
1. Only facts written in the text. Never add companies or numbers from your own knowledge.
2. `customers`: customers the filing says account for a share of revenue, sales or receivables.
   - `name`: the name exactly as written, or the filing's label if unnamed ("Customer A", "one distributor").
   - `share_pct`: the percentage as a number (e.g. 12 for "12%"), or null if no number is given.
   - `basis`: "revenue" or "receivables" (or "other"), whichever the percentage refers to.
   - `period`: the fiscal year or period the figure is for, as written (e.g. "fiscal 2026"), or "".
   Use the most recent period the text gives for each customer; one entry per customer.
3. `suppliers`: companies the filing NAMES as suppliers, manufacturers, foundries, licensors or
   partners it relies on. `role`: a few words from the text (e.g. "manufactures our chips").
   Skip generic phrases ("third-party suppliers", "contract manufacturers") unless a company is named.
4. `sole_source`: true if the filing says it relies on a single or limited number of sources for key
   components or manufacturing, else false.
5. Every customer and supplier needs `quote`: 5–40 words copied EXACTLY from ONE paragraph that
   contains the name (or the label and percentage), and `para`: that paragraph's number.
6. At most 10 customers and 15 suppliers, most important first. Empty lists are fine.
