import { Suspense } from "react";
import { PageContainer } from "../../_components/PageContainer";
import { WordPressMigrationClient } from "./WordPressMigrationClient";

export const metadata = { title: "Move from WordPress — Plexo" };

export default function WordPressMigrationPage() {
  return (
    <PageContainer>
      <Suspense fallback={null}>
        <WordPressMigrationClient />
      </Suspense>
    </PageContainer>
  );
}
