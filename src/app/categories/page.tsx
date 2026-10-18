import type { Metadata } from "next";
import CategoriesClient from "./CategoriesClient";

export const metadata: Metadata = {
  title: "Browse Categories — Live TV | StreamPulse",
  description:
    "Explore every StreamPulse channel category — news, sports, movies, music, kids, documentary and more. Tap a category to open the live player instantly.",
  alternates: { canonical: "/categories" },
};

export default function CategoriesPage() {
  return <CategoriesClient />;
}
