import { Info } from "lucide-react";

export function MockDataNotice() {
  return (
    <div
      role="note"
      className="flex items-start gap-2.5 rounded-xl border border-[#BFE4E8] bg-selected-teal px-3.5 py-3 text-xs leading-relaxed text-brand-teal dark:border-[#20484D] dark:bg-[#102A2E] dark:text-[#A6E5EB]"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">Frontend preview.</span> All records shown here are
        illustrative mock data. No employee data, authentication, Supabase, or live AI service is
        connected in this phase.
      </p>
    </div>
  );
}
