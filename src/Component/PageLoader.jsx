import { infinity } from 'ldrs';

// Register the infinity loader (required once in your app)
infinity.register();

const PageLoader = () => {
  return (
    <div style={styles.container}>
      <l-infinity
        size="55"
        stroke="4"
        stroke-length="0.15"
        bg-opacity="0.1"
        speed="1.3"
        color="hsl(13, 68%, 63%)" // A nice coral shade
      ></l-infinity>
    </div>
  );
};

// Basic styles for centering the loader
const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh', // Full viewport height
    backgroundColor: '#f5f5f5', // Light background for contrast
  },
};

export default PageLoader;