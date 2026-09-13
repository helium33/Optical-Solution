import { lazy } from 'react';
import { Navigate } from 'react-router-dom';

const ContactUsPage = lazy(() => import("../Feature/Public/Pages/ContactUsPage"));
const Feature = lazy(() => import("../Feature/Public/Pages/Feature"));
const HomePage = lazy(() => import("../Feature/Public/Pages/HomePage"));

/**
 * What sits at "/".
 *
 * The kiosk, by default. This project's active work is the attendance system —
 * the storefront is legacy content sharing the codebase, not the other way
 * round — so opening the app should not require knowing there is a second
 * path one level deeper. The storefront is unchanged and fully reachable at
 * /feature and /Contact-us; only the landing page moved.
 *
 * Opt back into the old behaviour (storefront at "/") with:
 *
 *     VITE_DEFAULT_APP=storefront
 *
 * — for a real public deployment where customers, not shop staff, are the
 * ones landing on "/".
 */
const LANDS_ON_STOREFRONT = import.meta.env.VITE_DEFAULT_APP === 'storefront';

const PublicRoutes = [
    {
        index : true,
        element : LANDS_ON_STOREFRONT
            ? <HomePage />
            : <Navigate to="/attendance/kiosk" replace />
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
