// Stage 1 retrieval evaluation set.
//
// Every case is a question a real user could ask, labelled with the document
// (and, where practical, the section) that should answer it. The labels come
// from the approved knowledge documents, not from what the retriever happens to
// return, so the set can expose regressions instead of freezing current
// behaviour.
//
// Two kinds of case are mixed on purpose:
//
// - "expectEvidence: true" - the answer is in the approved documents, so the
//   gold document has to be retrieved. Questions about prices, timelines, or
//   policies that the documents do *not* specify still belong here: the right
//   evidence is the section that says the detail is not specified.
// - "expectEvidence: false" - the question is unrelated to the company, so no
//   company document may be retrieved.

export type EvalCategory =
  | "exact"
  | "paraphrase"
  | "services"
  | "marque-contact"
  | "delivery"
  | "pricing"
  | "unrelated"
  | "technical";

export interface EvalCase {
  /** Stable identifier, used in the report and in the baseline snapshot. */
  id: string;
  category: EvalCategory;
  query: string;
  /** False when the question must be answered without company evidence. */
  expectEvidence: boolean;
  /** The document that should carry the answer. */
  goldDocumentId?: string;
  /** Other documents that would also answer the question correctly. */
  acceptableDocumentIds?: string[];
  /** At least one of these sections should carry the answer. */
  expectedSections?: string[];
  /** All of these sections should carry the answer. */
  requiredSections?: string[];
  /** Sections that would also answer the question correctly. */
  acceptableSections?: string[];
  /** Why the case is labelled the way it is. */
  note?: string;
}

export const EVAL_CASES: readonly EvalCase[] = [
  // ---------------------------------------------------------------- exact --
  {
    id: "exact-aaas",
    category: "exact",
    query: "What is AI-as-a-Service (AAAS)?",
    expectEvidence: true,
    goldDocumentId: "KB-002",
    expectedSections: ["AI-as-a-Service (AAAS)"],
  },
  {
    id: "exact-saas-platform",
    category: "exact",
    query: "Does Marque Technologies offer SaaS platform development?",
    expectEvidence: true,
    goldDocumentId: "KB-002",
    expectedSections: ["SaaS Platform Development"],
  },
  {
    id: "exact-co-design-stage",
    category: "exact",
    query: "What happens in the Co-design stage of a project?",
    expectEvidence: true,
    goldDocumentId: "KB-003",
    acceptableDocumentIds: ["KB-001"],
    expectedSections: ["2. Co-design"],
  },
  {
    id: "exact-launch-scale-stage",
    category: "exact",
    query: "What does the Launch and Scale stage cover?",
    expectEvidence: true,
    goldDocumentId: "KB-003",
    acceptableDocumentIds: ["KB-001"],
    expectedSections: ["4. Launch and Scale"],
  },
  {
    id: "exact-stated-benefits",
    category: "exact",
    query: "What benefits does the brochure state for the Marque Contact card?",
    expectEvidence: true,
    goldDocumentId: "KB-006",
    acceptableDocumentIds: ["KB-004"],
    expectedSections: ["Stated Benefits"],
  },
  {
    id: "exact-satisfaction-guarantee",
    category: "exact",
    query: "What does the brochure say about the 100% satisfaction guarantee?",
    expectEvidence: true,
    goldDocumentId: "KB-007",
    expectedSections: ["Satisfaction Guarantee"],
  },
  {
    id: "exact-nfc-how-it-works",
    category: "exact",
    query: "How is information transferred from the Marque Contact card?",
    expectEvidence: true,
    goldDocumentId: "KB-005",
    expectedSections: ["How It Works"],
  },
  {
    id: "exact-response-rule",
    category: "exact",
    query: "What is the Response Rule for pricing questions?",
    expectEvidence: true,
    goldDocumentId: "KB-007",
    expectedSections: ["Response Rule"],
  },

  // ----------------------------------------------------------- paraphrase --
  {
    id: "para-region-focus",
    category: "paraphrase",
    query: "Which part of the world does Marque Technologies focus on?",
    expectEvidence: true,
    goldDocumentId: "KB-001",
    expectedSections: ["Overview"],
    acceptableSections: ["Long-Term Vision"],
    note: "asks for the region without using the word 'Africa'",
  },
  {
    id: "para-price-quote",
    category: "paraphrase",
    query: "How do I get a price quote for a Marque Contact card?",
    expectEvidence: true,
    goldDocumentId: "KB-007",
    expectedSections: ["Pricing"],
    acceptableSections: ["How to Ask for Details"],
  },
  {
    id: "para-branding",
    category: "paraphrase",
    query: "Can I put my own logo and branding on the card?",
    expectEvidence: true,
    goldDocumentId: "KB-006",
    acceptableDocumentIds: ["KB-004"],
    expectedSections: ["Features"],
    acceptableSections: ["Core Offering"],
  },
  {
    id: "para-turnaround",
    category: "paraphrase",
    query: "How long does it take to produce the card after I order it?",
    expectEvidence: true,
    goldDocumentId: "KB-007",
    expectedSections: ["Delivery"],
    acceptableSections: ["How to Ask for Details"],
    note: "the source calls this 'turnaround' and states no timeframe",
  },
  {
    id: "para-phone-compatibility",
    category: "paraphrase",
    query: "Does the card work with any phone, or only with specific models?",
    expectEvidence: true,
    goldDocumentId: "KB-005",
    expectedSections: ["Knowledge Boundaries"],
    note: "the answer must say compatibility is not specified",
  },
  {
    id: "para-company-type",
    category: "paraphrase",
    query: "What kind of company is Marque Technologies and who does it work with?",
    expectEvidence: true,
    goldDocumentId: "KB-001",
    expectedSections: ["Overview"],
  },
  {
    id: "para-mobile-platforms",
    category: "paraphrase",
    query: "Do you build mobile applications for iPhone and Android?",
    expectEvidence: true,
    goldDocumentId: "KB-002",
    expectedSections: ["Mobile Application Development"],
    note: "the platform names are not in the source",
  },

  // ------------------------------------------------------------- services --
  {
    id: "svc-overview",
    category: "services",
    query: "What services does Marque Technologies offer?",
    expectEvidence: true,
    goldDocumentId: "KB-002",
    note: "answers span several sections of KB-002",
  },
  {
    id: "svc-web-performance",
    category: "services",
    query: "Do you build websites that load fast on mobile?",
    expectEvidence: true,
    goldDocumentId: "KB-002",
    expectedSections: ["Website Development and Optimisation"],
  },
  {
    id: "svc-chatbot",
    category: "services",
    query: "Can you build a chatbot that automates customer engagement?",
    expectEvidence: true,
    goldDocumentId: "KB-002",
    expectedSections: ["Intelligent Chatbots and Virtual Assistants"],
  },
  {
    id: "svc-ai-automation",
    category: "services",
    query: "Do you offer AI as a service for automating business operations?",
    expectEvidence: true,
    goldDocumentId: "KB-002",
    expectedSections: ["AI-as-a-Service (AAAS)"],
  },
  {
    id: "svc-recurring-revenue",
    category: "services",
    query: "Can you turn an existing service into a platform built around recurring revenue?",
    expectEvidence: true,
    goldDocumentId: "KB-002",
    expectedSections: ["SaaS Platform Development"],
  },

  // ------------------------------------------------------- marque-contact --
  {
    id: "mc-what-is",
    category: "marque-contact",
    query: "What is Marque Contact?",
    expectEvidence: true,
    goldDocumentId: "KB-004",
    acceptableDocumentIds: ["KB-002", "KB-006"],
    expectedSections: ["What Is Marque Contact?"],
  },
  {
    id: "mc-purpose",
    category: "marque-contact",
    query: "What is the purpose of the Marque Contact product?",
    expectEvidence: true,
    goldDocumentId: "KB-005",
    acceptableDocumentIds: ["KB-002"],
    expectedSections: ["Purpose"],
  },
  {
    id: "mc-paper-cards",
    category: "marque-contact",
    query: "Does Marque Contact reduce the need to print paper business cards?",
    expectEvidence: true,
    goldDocumentId: "KB-006",
    expectedSections: ["Stated Benefits"],
    acceptableSections: ["Features"],
  },
  {
    id: "mc-technical-support",
    category: "marque-contact",
    query: "Is ongoing technical support included with the card?",
    expectEvidence: true,
    goldDocumentId: "KB-007",
    acceptableDocumentIds: ["KB-006", "KB-004"],
    expectedSections: ["Support"],
    acceptableSections: ["Features", "Core Offering"],
  },
  {
    id: "mc-customisation",
    category: "marque-contact",
    query: "Can the card be customised?",
    expectEvidence: true,
    goldDocumentId: "KB-006",
    acceptableDocumentIds: ["KB-004"],
    expectedSections: ["Features"],
    acceptableSections: ["Core Offering"],
  },

  // ------------------------------------------------------------- delivery --
  {
    id: "del-four-stages-regression",
    category: "delivery",
    query:
      "What are the four stages of Marque Technologies' project delivery process? Explain each stage using the approved knowledge base and show your sources.",
    expectEvidence: true,
    goldDocumentId: "KB-003",
    acceptableDocumentIds: ["KB-001"],
    requiredSections: [
      "1. Discover",
      "2. Co-design",
      "3. Build and Test",
      "4. Launch and Scale",
    ],
    note: "regression case: the framed question must still find all four stages",
  },
  {
    id: "del-how",
    category: "delivery",
    query: "How does Marque Technologies deliver a project?",
    expectEvidence: true,
    goldDocumentId: "KB-003",
    expectedSections: ["1. Discover"],
  },
  {
    id: "del-discover",
    category: "delivery",
    query: "What does the Discover step assess?",
    expectEvidence: true,
    goldDocumentId: "KB-003",
    expectedSections: ["1. Discover"],
  },
  {
    id: "del-build-and-test",
    category: "delivery",
    query: "What does Marque Technologies build and test?",
    expectEvidence: true,
    goldDocumentId: "KB-003",
    acceptableDocumentIds: ["KB-001"],
    expectedSections: ["3. Build and Test"],
  },
  {
    id: "del-duration",
    category: "delivery",
    query: "How long does a typical project take?",
    expectEvidence: true,
    goldDocumentId: "KB-003",
    expectedSections: ["Knowledge Boundaries"],
    note: "the answer must say the source states no project durations",
  },

  // -------------------------------------------------------------- pricing --
  {
    id: "price-cost",
    category: "pricing",
    query: "How much does a Marque Contact card cost?",
    expectEvidence: true,
    goldDocumentId: "KB-007",
    expectedSections: ["Pricing"],
    note: "the answer must not state a price",
  },
  {
    id: "price-exact-amount",
    category: "pricing",
    query: "What is the exact price of the card?",
    expectEvidence: true,
    goldDocumentId: "KB-007",
    expectedSections: ["Pricing"],
    note: "the answer must not state a price",
  },
  {
    id: "price-refund",
    category: "pricing",
    query: "What is your refund policy?",
    expectEvidence: true,
    goldDocumentId: "KB-007",
    expectedSections: ["Response Rule"],
    note: "the source states no refund terms",
  },
  {
    id: "price-tailored",
    category: "pricing",
    query: "Is the pricing fixed or tailored to the customer?",
    expectEvidence: true,
    goldDocumentId: "KB-007",
    expectedSections: ["Pricing"],
  },

  // ------------------------------------------------------------ unrelated --
  {
    id: "unrel-python-regression",
    category: "unrelated",
    query: "Can you write me a Python function that sorts a list?",
    expectEvidence: false,
    note: "regression case: an unrelated request must retrieve no company content",
  },
  {
    id: "unrel-weather",
    category: "unrelated",
    query: "What is the weather in Lagos today?",
    expectEvidence: false,
  },
  {
    id: "unrel-recipe",
    category: "unrelated",
    query: "What is a good recipe for jollof rice?",
    expectEvidence: false,
  },
  {
    id: "unrel-javascript-error",
    category: "unrelated",
    query: "How do I fix a TypeError in JavaScript?",
    expectEvidence: false,
  },

  // ------------------------------------------------------------ technical --
  {
    id: "tech-typescript-setup",
    category: "technical",
    query: "How do I set up a TypeScript project with tsconfig?",
    expectEvidence: false,
  },
  {
    id: "tech-sql-nosql",
    category: "technical",
    query: "What is the difference between SQL and NoSQL databases?",
    expectEvidence: false,
  },
  {
    id: "tech-css-flexbox",
    category: "technical",
    query: "How do I center a div with CSS flexbox?",
    expectEvidence: false,
  },
  {
    id: "tech-http-404",
    category: "technical",
    query: "What does the HTTP status code 404 mean?",
    expectEvidence: false,
  },
];
