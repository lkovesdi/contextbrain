// Provider-neutral types for "create a ticket from a meeting suggestion".
// The Jira/Linear adapters in lib/jira.ts and lib/linear.ts implement
// `createIssue(userId, input)` against this shape.

export type TicketType = "story" | "task" | "bug" | "epic";
export type TicketPriority = "urgent" | "high" | "medium" | "low" | "none";
export type TicketProvider = "jira" | "linear";

export type CreateIssueInput = {
  title: string;
  description: string;
  type: TicketType;
  priority?: TicketPriority;
  // Set when the meeting names someone; passed through as a hint, providers
  // map it to their own identity systems if possible.
  suggestedOwner?: string | null;
};

export type CreatedIssue = {
  provider: TicketProvider;
  key: string; // e.g. "ENG-432" or "PROJ-12"
  url: string | null;
};
