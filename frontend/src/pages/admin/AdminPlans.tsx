import { usePlans } from "../../api/hooks";
import { PageHeader } from "../../components/AppShell";
import { Badge, Card, Spinner } from "../../components/ui";

export default function AdminPlans() {
  const { data: plans, isLoading } = usePlans();

  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="Usage tiers backed by RHCL PlanPolicy (gold / silver / bronze)."
      />
      {isLoading ? (
        <Spinner />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-medium">Plan</th>
                <th className="px-5 py-3 font-medium">Tier</th>
                <th className="px-5 py-3 font-medium">Rate limit</th>
                <th className="px-5 py-3 font-medium">Daily quota</th>
                <th className="px-5 py-3 font-medium">Approval</th>
                <th className="px-5 py-3 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {plans?.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-800">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.description}</div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={p.tier}>{p.tier}</Badge>
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {p.rpmLimit === 0 ? "Unlimited" : `${p.rpmLimit} req/min`}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{p.dailyQuota > 0 ? p.dailyQuota.toLocaleString() : "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{p.approvalRequired ? "Required" : "Auto"}</td>
                  <td className="px-5 py-3">{p.active ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
