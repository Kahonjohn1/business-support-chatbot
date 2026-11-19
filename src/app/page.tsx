import { redirect } from "next/navigation";
import { requireUserPage } from "@/lib/workspace/server";

export const instant = false;

export default async function Home() {
  await requireUserPage("/");
  redirect("/c/new");
}
