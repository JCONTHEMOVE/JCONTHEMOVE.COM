import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OwnerApprovalRequestState } from "@shared/job-workflow";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

/** Request-only view for coworkers whose role does not expose quote prices. */
export function OwnerApprovalRequest({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["/api/leads", leadId, "owner-approval-request"];
  const [notice, setNotice] = useState("");
  const { data, isError, refetch } = useQuery<OwnerApprovalRequestState>({ queryKey, retry: false, refetchInterval: query => query.state.data?.current ? 15_000 : false });
  const request = useMutation({
    mutationFn: async () => {
      if (!data) throw Error("Reload the job before requesting approval.");
      return (await apiRequest("POST", `/api/leads/${leadId}/request-owner-approval`, { version: data.version })).json();
    },
    onSuccess: async () => {
      setNotice("Approval request saved in the owner's notifications.");
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: async () => { await queryClient.invalidateQueries({ queryKey }); },
  });
  return <section className="mb-4 rounded-xl border p-4" aria-label="Owner quote approval">
    <p className="mb-3 text-sm">{data?.approved ? "The quote is approved." : data?.current ? "Waiting for owner approval." : "The owner reviews the saved quote before the job can be dispatched."}</p>
    {notice && <p role="status" className="mb-3 text-sm">{notice}</p>}
    {request.isError && <p role="alert" className="mb-3 text-sm text-destructive">The request could not finish. Check the current job and try again, or ask the owner to review its saved details.</p>}
    {isError ? <Button variant="outline" onClick={() => refetch()}>Reload approval status</Button> : <Button className="min-h-11" disabled={!data?.canRequest || data.current || request.isPending} onClick={() => request.mutate()}>{request.isPending ? "Requesting…" : data?.current ? "Approval requested" : data?.approved ? "Quote approved" : "Request owner approval"}</Button>}
  </section>;
}
