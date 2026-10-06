import AuthScreen from "../../components/AuthScreen";

export const metadata = { title: "Sign in | TRACK3D" };

// /login?deleted=1 is where the app goes after Delete my account.
export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  return <AuthScreen mode="login" notice={params?.deleted === "1" ? "Your account and data have been deleted." : ""} />;
}
