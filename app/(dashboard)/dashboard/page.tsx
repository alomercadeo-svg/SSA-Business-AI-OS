import { redirect } from "next/navigation";

export default function DashboardPage() {
  // La bandeja es para todos; Flujos es del fork y de managers (1b, ítem 4 de la sesión de cierre).
  redirect("/dashboard/inbox");
}
