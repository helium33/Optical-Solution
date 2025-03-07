const Footer = () => {
    return (
      <footer className="bg-gray-900 text-white py-10 mt-auto">
        <div className="container mx-auto grid grid-cols-1 md:grid-cols-4 gap-6 px-6">
          
          {/* Store Info */}
          <div>
            <h2 className="text-xl font-bold">Eyewear Store</h2>
            <p className="mt-2 text-gray-400">
              Quality eyewear for everyone. Find your perfect pair today!
            </p>
          </div>
  
          {/* Quick Links */}
          <div>
            <h3 className="text-lg font-semibold">Quick Links</h3>
            <ul className="mt-2 space-y-2 text-gray-400">
              <li><a href="/sunglasses" className="hover:text-white">Sunglasses</a></li>
              <li><a href="/eyeglasses" className="hover:text-white">Eyeglasses</a></li>
              <li><a href="/lenses" className="hover:text-white">Lenses</a></li>
              <li><a href="/features" className="hover:text-white">Features</a></li>
            </ul>
          </div>
  
          {/* Customer Support */}
          <div>
            <h3 className="text-lg font-semibold">Customer Support</h3>
            <ul className="mt-2 space-y-2 text-gray-400">
              <li><a href="/contact" className="hover:text-white">Contact Us</a></li>
              <li><a href="/faq" className="hover:text-white">FAQ</a></li>
              <li><a href="/returns" className="hover:text-white">Returns & Exchanges</a></li>
              <li><a href="/shipping" className="hover:text-white">Shipping Info</a></li>
              <li><a href="/privacy" className="hover:text-white">Privacy Policy</a></li>
            </ul>
          </div>
  
          {/* Newsletter & Socials */}
          <div>
            <h3 className="text-lg font-semibold">Stay Updated</h3>
            <p className="mt-2 text-gray-400">Subscribe for exclusive deals & updates!</p>
            <div className="mt-4 flex">
              <input
                type="email"
                placeholder="Enter your email"
                className="w-full px-3 py-2 text-gray-900 rounded-l-md outline-none"
              />
              <button className="bg-blue-500 px-4 py-2 rounded-r-md hover:bg-blue-600">
                Subscribe
              </button>
            </div>
            {/* Social Icons */}
            <div className="mt-4 flex space-x-4 text-xl">
              <a href="#" className="hover:text-blue-400">📘</a>
              <a href="#" className="hover:text-pink-400">📸</a>
              <a href="#" className="hover:text-blue-300">🐦</a>
              <a href="#" className="hover:text-red-400">▶️</a>
            </div>
          </div>
        </div>
  
        {/* Copyright */}
        <div className="mt-8 text-center text-gray-500 text-sm border-t border-gray-700 pt-4">
          &copy; {new Date().getFullYear()} Eyewear Store. All rights reserved.
        </div>
      </footer>
    );
  };
  
  export default Footer;
  