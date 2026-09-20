import type { Metadata } from "next";

import { AnalysisView } from "@/components/v2/AnalysisView";

export const metadata: Metadata = { title: "Analysis" };

/**
 * One analysis, from the moment it is created to the finished report.
 *
 * The whole lifecycle lives at a stable URL on purpose: consent and payment
 * happen elsewhere and take as long as they take, so the page a user comes
 * back to has to be the same page they left.
 */
export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return <AnalysisView jobId={jobId} />;
}
