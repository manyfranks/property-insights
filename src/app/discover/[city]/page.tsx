import { redirect } from "next/navigation";
import { buildCityMetadata, getCityBySlug } from "@/lib/data/city-metadata";
import { getAllListings } from "@/lib/kv/listings";

export default async function DiscoverCityPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const listings = await getAllListings();
  const { cities } = buildCityMetadata(listings);
  const meta = getCityBySlug(city, cities);
  if (meta) {
    redirect(`/dashboard?city=${encodeURIComponent(meta.name)}`);
  }
  redirect("/dashboard");
}
