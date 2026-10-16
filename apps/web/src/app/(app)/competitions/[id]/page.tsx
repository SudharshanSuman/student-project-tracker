import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/states";
import { serverApi } from "@/lib/api-server";
import { formatDate } from "@/lib/utils";
import { CompetitionForm, type CompetitionValues } from "../competition-form";
import { DeleteCompetition, Registrations, type Registration } from "./registrations";

export const metadata: Metadata = { title: "Competition" };

interface Data {
  competition: CompetitionValues & { id: string; createdBy: { name: string }; _count: { registrations: number } };
  registrations: Registration[];
  registrable: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}

export default async function CompetitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await serverApi<Data>(`/competitions/${id}`);
  const c = d.competition;
  return (
    <>
      <Link href="/competitions" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" /> Competition hub</Link>
      <PageHeader
        title={c.name}
        description={`${c.organizer} · added by ${c.createdBy.name}`}
        actions={<>{d.canEdit ? <CompetitionForm initial={c} /> : null}{d.canDelete ? <DeleteCompetition id={c.id} disabled={c._count.registrations > 0} /> : null}</>}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Registrations competitionId={c.id} registrations={d.registrations} registrable={d.registrable} />
        <Card className="h-fit">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {c.description ? <p className="text-muted-foreground">{c.description}</p> : null}
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-muted-foreground">Starts</dt><dd className="font-mono">{formatDate(c.startDate)}</dd>
              <dt className="text-muted-foreground">Ends</dt><dd className="font-mono">{formatDate(c.endDate)}</dd>
              <dt className="text-muted-foreground">Submission deadline</dt><dd className="font-mono">{formatDate(c.submissionDeadline)}</dd>
              <dt className="text-muted-foreground">Registrations</dt><dd className="font-mono">{c._count.registrations}</dd>
            </dl>
            {c.eligibility ? <div><p className="text-xs font-medium">Eligibility</p><p className="text-xs text-muted-foreground">{c.eligibility}</p></div> : null}
            {c.registrationUrl ? <a href={c.registrationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Registration page <ExternalLink className="h-3 w-3" /></a> : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
