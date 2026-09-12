import { createBrowserRouter } from "react-router-dom";
import NotFound from "../Component/NotFound";
import PublicLayout from "../Feature/Public/Component'/PublicLayout";
import PublicRoutes from "./PublicRoutes";
import AttendanceRoutes from "./AttendanceRoutes";
import AttendanceError from "../Feature/Attendance/pages/AttendanceError";
import PageLoader from "../Component/PageLoader";

const router =  createBrowserRouter([
    {
        path : '/',
        element : <PublicLayout />,
        errorElement : <NotFound />,
        children : [...PublicRoutes]
       
    },
    {
        // The staff attendance app. Its own layout, providers and theme — the
        // storefront chrome would be in the way on a shop tablet. Loaded
        // through route-level `lazy` so none of it (Firebase especially)
        // reaches a customer browsing the shop.
        path : '/attendance',
        // Not the storefront's 404: a kiosk that fails to boot needs the real
        // error and a retry, not a "page not found".
        errorElement : <AttendanceError />,
        // Required because this route resolves through `lazy` — without it
        // React Router has nothing to render on the very first paint.
        HydrateFallback : PageLoader,
        lazy : async () => {
            const { default: AttendanceLayout } = await import(
                "../Feature/Attendance/pages/AttendanceLayout"
            );
            return { Component: AttendanceLayout };
        },
        children : [...AttendanceRoutes]
    }


]);
export default router;
