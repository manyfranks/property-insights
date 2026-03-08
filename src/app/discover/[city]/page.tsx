import { redirect } from "next/navigation";
import { getCityBySlug } from "@/lib/data/city-metadata";

export default async function DiscoverCityPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const meta = getCityBySlug(city);
  if (meta) {
    redirect(`/dashboard?city=${encodeURIComponent(meta.name)}`);
  }
  redirect("/dashboard");
}
