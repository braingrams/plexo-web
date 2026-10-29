import LoginPage from "@/app/auth/login/page";

// plexo.charisol.io is a dashboard-only app — serve the login page at root
// so there's no redirect chain (was: / → /dashboard → /auth/login).
export default LoginPage;
