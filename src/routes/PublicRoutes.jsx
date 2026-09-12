import { lazy } from 'react';
import { Navigate } from 'react-router-dom';

const ContactUsPage = lazy(() => import("../Feature/Public/Pages/ContactUsPage"));
const Feature = lazy(() => import("../Feature/Public/Pages/Feature"));
const HomePage = lazy(() => import("../Feature/Public/Pages/HomePage"));

/**
 * What sits at "/".
 *
 * By default the storefront, as before. But a shop tablet should open the
 * browser and land on the kiosk — not on a page of sunglasses with the real
 * app hidden one URL deeper. Set this in .env on the tablet:
 *
 *     VITE_DEFAULT_APP=attendance
 *
 * and "/" goes straight to the kiosk. The storefront is still reachable at
 * /feature and /Contact-us, and nothing about it changes; only the landing
 * page moves.
 */
const LANDS_ON_ATTENDANCE = import.meta.env.VITE_DEFAULT_APP === 'attendance';

const PublicRoutes = [
    {
        index : true,
        element : LANDS_ON_ATTENDANCE
            ? <Navigate to="/attendance/kiosk" replace />
            : <HomePage />
    },
    {
        path : '/feature',
        element : <Feature />
    },
    {
        path : '/Contact-us',
        element : <ContactUsPage />
    }
];
export default PublicRoutes;
