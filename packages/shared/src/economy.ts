/**
 * Every faucet (money in) and sink (money out) is named here and logged on the
 * ledger as the `reason` of a Transaction. Add new ones here, nowhere else.
 *
 * These are names only. Amounts (fees, wages, prices) live in `content/`
 * with a source and an asOf date, never in code.
 */

// ---- Faucets: money entering a player's wallet ----------------------------

const INCOME_REASONS = [
  "starting_balance",
  "shift_pay",
  "side_hustle_income",
  /** Regular salary from a job, in Lagos or abroad. */
  "salary",
  /** Family sending money to the player (not another player; see transfers). */
  "family_help",
  /** Selling belongings ahead of the move (japa sales). */
  "japa_sale_proceeds",
  /** The player's turn to collect from an ajo (rotating savings) circle. */
  "ajo_payout",
  "scholarship_payout",
  "tax_refund",
  /** Rental deposit returned at the end of a tenancy. */
  "deposit_refund",
  /**
   * A fee the real system refunds, e.g. the UK Immigration Health Surcharge
   * when an application is refused. Most fees are NOT refundable; a refusal
   * loses them, which is part of the struggle.
   */
  "visa_fee_refund",
] as const;

export const FAUCET_REASONS = INCOME_REASONS;

// ---- Sinks: money leaving a player's wallet --------------------------------

/** Everyday living costs, in Lagos and abroad. */
const LIVING_REASONS = [
  "rent",
  "food",
  "black_tax",
  "transport",
  "power_bill",
  "generator_fuel",
  "airtime_data",
  "medical_care",
  "health_insurance",
  "income_tax",
  "rental_deposit",
] as const;

/** Documents gathered before applying (mostly Nigerian side). */
const DOCUMENT_REASONS = [
  "passport_fee",
  "police_clearance_fee",
  "transcript_fee",
  "credential_evaluation_fee",
  "english_test_fee",
  "medical_exam_fee",
  "courier_fee",
] as const;

/**
 * Immigration fees charged by a government or its visa centre, for the UK and
 * Canada routes. Kept as a named group so realism rules can find them.
 */
export const VISA_FEE_REASONS = [
  /** The application fee for a visa or entry clearance (route decides the amount). */
  "visa_application_fee",
  /** UK Immigration Health Surcharge, paid up front for the visa's length. */
  "immigration_health_surcharge",
  "biometrics_fee",
  /** The visa application centre's own service charge, on top of the government fee. */
  "visa_centre_service_fee",
  /** Paying extra for a faster decision. */
  "priority_processing_fee",
  /** Required TB test at an approved clinic. */
  "tb_test_fee",
  "study_permit_fee",
  "work_permit_fee",
  /** Canada Express Entry: the principal applicant's processing fee. */
  "express_entry_processing_fee",
  /** Canada: paid before permanent residence is granted. */
  "right_of_permanent_residence_fee",
  "permit_extension_fee",
  /** UK: applying to settle (indefinite leave to remain). */
  "settlement_application_fee",
  "citizenship_application_fee",
] as const;

/** Leaving, and what the move itself costs. */
const DEPARTURE_REASONS = [
  "flight_ticket",
  "excess_baggage_fee",
  /** The airport send-off: food, drinks, and everyone who came to see you off. */
  "airport_send_off",
] as const;

/** Sending money home, and the savings circle. */
const FAMILY_REASONS = ["remittance_sent", "ajo_contribution"] as const;

/**
 * Scam and fraud traps (CLAUDE.md: shortcuts that are fraud in real life exist
 * only as traps with heavy consequences, never as winning strategies).
 */
const FRAUD_REASONS = [
  /** Money lost to a scam: a fake agent, fake job offer, or fake bank statement service. */
  "scam_loss",
  /** The penalty for being caught submitting fake documents. */
  "fraud_penalty",
] as const;

export const SINK_REASONS = [
  ...LIVING_REASONS,
  ...DOCUMENT_REASONS,
  ...VISA_FEE_REASONS,
  ...DEPARTURE_REASONS,
  ...FAMILY_REASONS,
  ...FRAUD_REASONS,
] as const;

export const LEDGER_REASONS = [...FAUCET_REASONS, ...SINK_REASONS] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];
