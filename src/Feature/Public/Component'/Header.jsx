import { useState, useRef } from "react";
import useSWR from "swr";
import { FaUser, FaSignInAlt, FaUserPlus, FaChevronDown } from "react-icons/fa";
import PageLoader from "../../../Component/PageLoader";

const fetcher = (url) => fetch(url).then((res) => res.json());

const Header = () => {
  const { data: navItems, error } = useSWR("http://localhost:3001/navbar", fetcher);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [filteredItems, setFilteredItems] = useState([]);
  const dropdownRef = useRef(null);

  if (error) return <p>Failed to load menu.</p>;
  if (!navItems) return <PageLoader />;

  // Search Filtering
  const handleSearch = (e) => {
    const value = e.target.value;
    setSearch(value);

    if (!value.trim()) {
      setFilteredItems([]);
      return;
    }

    const results = [];
    navItems.forEach((category) => {
      category.submenu.forEach((item) => {
        if (item.title.toLowerCase().includes(value.toLowerCase())) {
          results.push({ ...item, category: category.name });
        }
      });
    });

    setFilteredItems(results);
  };

  // Toggle dropdown function
  const toggleDropdown = (menuName) => {
    setOpenDropdown(openDropdown === menuName ? null : menuName);
  };

  return (
    <nav className="bg-white shadow-md">
      <div className="container mx-auto flex justify-between items-center py-4 px-6">
        {/* Logo */}
        <h1 className="text-2xl font-bold">Eyewear Store</h1>

        {/* Search Bar */}
        <div className="relative hidden md:flex items-center border border-gray-300 rounded-md px-2">
          <input
            type="text"
            placeholder="Search..."
            className="outline-none p-2"
            value={search}
            onChange={handleSearch}
          />
          <button className="text-gray-500 px-2">🔍</button>

          {/* Search Results Dropdown */}
          {filteredItems.length > 0 && (
            <ul className="absolute top-12 left-0 w-full bg-white shadow-md rounded-md z-10">
              {filteredItems.map((item, index) => (
                <li
                  key={index}
                  className="px-4 py-2 hover:bg-gray-200 cursor-pointer"
                  onClick={() => setSearch("")}
                >
                  <a href={item.link}>
                    <span className="font-semibold">{item.category}:</span> {item.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button className="lg:hidden text-xl" onClick={() => setMobileMenu(!mobileMenu)}>
          ☰
        </button>

        {/* Desktop Menu with Clickable Dropdowns */}
        <ul className="hidden lg:flex space-x-6">
          {navItems.map((item) => (
            <li key={item.id} className="relative">
              <button
                className="flex items-center hover:text-blue-500"
                onClick={() => toggleDropdown(item.name)}
              >
                {item.name}
                {item.submenu && <FaChevronDown className="ml-2 text-sm" />}
              </button>

              {openDropdown === item.name && (
                <ul
                  ref={dropdownRef}
                  className="absolute left-0 mt-2 w-48 bg-white shadow-md rounded-md z-50"
                >
                  {item.submenu.map((sub) => (
                    <li key={sub.id} className="px-4 py-2 hover:bg-gray-200 flex items-center">
                      <a href={sub.link} className="flex items-center">
                        {sub.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>

        {/* Account Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            className="text-xl flex items-center focus:outline-none"
            onClick={() => toggleDropdown("account")}
          >
            <FaUser className="mr-2" /> Account <FaChevronDown className="ml-2 text-sm" />
          </button>

          {openDropdown === "account" && (
            <ul className="absolute top-12 left-0 w-48 bg-white shadow-md rounded-md z-50">
              <li className="px-4 py-2 hover:bg-gray-200">
                <a href="/login" className="flex items-center">
                  <FaSignInAlt className="mr-2" /> Login
                </a>
              </li>
              <li className="px-4 py-2 hover:bg-gray-200">
                <a href="/signup" className="flex items-center">
                  <FaUserPlus className="mr-2" /> Sign Up
                </a>
              </li>
            </ul>
          )}
        </div>

        {/* Cart Icon */}
        <a href="/cart" className="text-xl">🛒</a>
      </div>

      {/* Mobile Menu */}
      {mobileMenu && (
        <div className="lg:hidden bg-white shadow-md">
          <ul>
            {navItems.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => toggleDropdown(item.name)}
                  className="block w-full text-left px-6 py-3 hover:bg-gray-100"
                >
                  <div className="flex items-center">
                    {item.name}
                    {item.submenu && <FaChevronDown className="ml-2 text-sm" />}
                  </div>
                </button>

                {openDropdown === item.name && (
                  <ul className="bg-gray-100">
                    {item.submenu.map((sub) => (
                      <li key={sub.id} className="px-6 py-2 hover:bg-gray-200 flex items-center">
                        <a href={sub.link} className="flex items-center">
                          {sub.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            <li className="px-6 py-3">
              <a href="/login" className="flex items-center">
                <FaSignInAlt className="mr-2" /> Login
              </a>
            </li>
            <li className="px-6 py-3">
              <a href="/signup" className="flex items-center">
                <FaUserPlus className="mr-2" /> Sign Up
              </a>
            </li>
            <li className="px-6 py-3">
              <a href="/cart">🛒 Buy</a>
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
};

export default Header;
