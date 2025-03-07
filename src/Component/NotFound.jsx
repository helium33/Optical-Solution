import React from "react";
import { Link } from "react-router-dom"; // For navigation links
import { FaGlasses } from "react-icons/fa"; // Updated to an optics icon

const NotFoundPage = () => {
  return (
    <section className="flex items-center justify-center h-screen bg-gradient-to-r from-purple-400 via-pink-500 to-red-500">
      <div className="text-center text-white px-6 py-10 bg-black bg-opacity-50 rounded-lg">
        <FaGlasses className="text-6xl mb-4 mx-auto" /> {/* Optics-related icon */}
        <h1 className="text-5xl font-extrabold mb-4">Oops! Page Not Found</h1>
        <p className="text-lg mb-6">Looks like you've taken a wrong turn. Don't worry, we'll get you back on track!</p>
        
        <Link to="/" className="bg-blue-500 text-white py-2 px-6 rounded-full text-xl hover:bg-blue-600 transition duration-300">
          Go Back to Home
        </Link>
      </div>
    </section>
  );
};

export default NotFoundPage;
