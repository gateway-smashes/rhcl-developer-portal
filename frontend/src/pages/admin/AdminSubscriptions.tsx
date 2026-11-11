import { useState } from "react";
import {
  useAdminSubscriptions,
  useApproveSubscription,
  useRejectSubscription,
  useSuspendSubscription,
} from "../../api/hooks";
import { PageHeader } from "../../components/AppShell";
import { Badge, Button, Card, EmptyState, Select, Spinner } from "../../components/ui";
import CredentialDialog from "../../components/CredentialDialog";
import type { ApiCredential } from "../../api/types";

const STATUSES = ["", "PENDING", "APPROVED", "REJECTED", "SUSPENDED"];

export default function AdminSubscriptions() {
  const [status, setStatus] = useState("");
  const { data: subs, isLoading } = useAdminSubscriptions(status || undefined);
  const approve = useApproveSubscription();
  const reject = useRejectSubscription();
  const suspend = useSuspendSubscription();
  const [credential, setCredential] = useState<ApiCredential | null>(null);

  const doApprove = async (id: number) => {
    const res = await approve.mutateAsync(id);
    if (res.credential) setCredential(res.credential);
  };
  const doReject = async (id: number) => {
    const reason = window.prompt("Rejection reason?") ?? "";
    await reject.mutateAsync({ id, reason });
  };

  return (
    <>
      <PageHeader
        title="Subscriptions"
        subtitle="Review and act on access requests across all APIs."
        actions={
          <Select value={status} onChange={(e: { target: { value: string } }) => setStatus(e.target.value)} style={{ width: 180 }}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || "All statuses"}
              </option>
            ))}
          </Select>
        }
      />
      {isLoading ? (
        <Spinner />
      ) : !subs || subs.length === 0 ? (
        <EmptyState title="No subscriptions" />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-medium">API</th>
                <th className="px-5 py-3 font-medium">Application</th>
                <th className="px-5 py-3 font-medium">Plan</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3 font-medium text-slate-800">{s.apiProductName}</td>
                  <td className="px-5 py-3 text-slate-600">{s.applicationName}</td>
                  <td className="px-5 py-3">
                    <Badge tone={s.planTier}>{s.planTier}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={s.status}>{s.status}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      {s.status === "PENDING" && (
                        <>
                          <Button size="sm" onClick={() => doApprove(s.id)}>
                            Approve
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => doReject(s.id)}>
                            Reject
                          </Button>
                        </>
                      )}
                      {s.status === "APPROVED" && (
                        <Button size="sm" variant="danger" onClick={() => suspend.mutate(s.id)}>
                          Suspend
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {credential && <CredentialDialog credential={credential} onClose={() => setCredential(null)} />}
    </>
  );
}
