export type Customer = {
  id: string;
  name: string; // legal name on the invoice
  aliases: string[]; // names we've seen this customer pay from before (payer history)
};

export type Invoice = {
  id: string;
  number: string; // e.g. INV-1042
  customer_id: string;
  amount: number; // USD, 2 decimals
  issued: string; // ISO date
  due: string;
  status: "open";
};

export type Rail = "ach" | "wire" | "card" | "check";

export type Payment = {
  id: string;
  date: string;
  amount: number;
  rail: Rail;
  counterparty: string; // as it shows on the bank feed
  memo: string;
  virtual_account: string | null; // customer id whose virtual account number received it; null = main account number
};

export type Allocation = { invoice_id: string; amount: number };

export type ResidualType = "none" | "processing_fee" | "short_pay" | "partial" | "overpayment";

// What a correct handler would do with this payment.
export type IdealAction =
  | "auto" // unambiguous: a careful human would apply it without a second look
  | "review" // genuinely needs a human (ambiguous, partial, overpaid)
  | "no_invoice"; // not a customer paying an invoice (refund, interest, transfer)

export type Scenario =
  | "clean"
  | "no_memo"
  | "garbled_memo"
  | "wire_fee"
  | "multi_invoice"
  | "partial"
  | "different_payer"
  | "ambiguous"
  | "overpayment"
  | "wrong_reference"
  | "twin_amount"
  | "not_invoice";

export type GroundTruth = {
  payment_id: string;
  scenario: Scenario;
  ideal: IdealAction;
  allocations: Allocation[]; // empty for no_invoice
  residual: ResidualType;
  note: string;
};

// Output of any matcher, before policy.
export type Proposal = {
  payment_id: string;
  decision: "match" | "not_invoice_payment" | "unsure";
  allocations: Allocation[];
  residual: ResidualType;
  confidence: number; // 0..1
  reasoning: string;
  alternatives: string[]; // other invoice ids worth showing a reviewer
};

// Output of policy: what the product actually does.
export type Action = {
  payment_id: string;
  action: "auto_apply" | "review" | "leave_unmatched";
  proposal: Proposal;
  why: string; // which policy rule fired
};
