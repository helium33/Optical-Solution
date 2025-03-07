import { createBrowserRouter } from "react-router-dom";
import NotFound from "../Component/NotFound";
import PublicLayout from "../Feature/Public/Component'/PublicLayout";
import PublicRoutes from "./PublicRoutes";

const router =  createBrowserRouter([
    {
        path : '/',
        element : <PublicLayout />,
        errorElement : <NotFound />,
        children : [...PublicRoutes]
       
    }


]);
export default router;