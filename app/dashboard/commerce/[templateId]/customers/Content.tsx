import { CustomersClient } from "./CustomersClient";

export async function CustomersContent({ templateId }: { templateId: string }) {
  return <CustomersClient templateId={templateId} />;
}
