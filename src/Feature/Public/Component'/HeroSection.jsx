import React from "react";
import img1 from '../../../assets/abhinav-arya-JkZWswSre3g-unsplash.jpg' ;  // Import your image here

const HeroSection = () => {
  return (
    <section
      className="relative bg-cover bg-center h-screen"
      style={{ backgroundImage: `url(${img1})`} } // Replace with your actual image URL
    >
      <div className="absolute inset-0 bg-black opacity-30"></div> {/* Overlay to darken the background */}
      <div className="relative z-10 flex flex-col justify-center items-center h-full text-center text-white px-6">
        <h1 className="text-5xl font-bold mb-4">
          Find Your Perfect Pair of Glasses
        </h1>
        <p className="text-lg mb-6">
          Explore a wide selection of eyewear styles to suit your personality and needs.
        </p>
        <a
          href="/shop"
          className="bg-blue-500 text-white py-2 px-6 rounded-full text-xl hover:bg-blue-600 transition duration-300"
        >
          Shop Now
        </a>
      </div>
    </section>
  );
};

export default HeroSection;
