import { lazy } from 'react';

const ContactUsPage = lazy(() => import("../Feature/Public/Pages/ContactUsPage"));
const Feature = lazy(() => import("../Feature/Public/Pages/Feature"));
const HomePage = lazy(() => import("../Feature/Public/Pages/HomePage"));

const PublicRoutes = [
    {
        index : true,
        element : <HomePage />
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