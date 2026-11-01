import { requirePageAuth } from "../../../lib/session.ts";
import { PwaSpikeClient } from "../../../components/pwa-spike-client.tsx";

export const dynamic = "force-dynamic";

export default async function PwaSpikeDiagnosticsPage() {
  await requirePageAuth();
  return <PwaSpikeClient />;
}
