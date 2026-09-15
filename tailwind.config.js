/** @type {import('tailwindcss').Config} */

/**
 * Every colour in this app is a CSS custom property holding an *RGB channel
 * triplet* ("33 28 81"), never a finished colour string. That single decision is
 * what makes branch theming work: Tailwind still generates one static class
 * (`bg-brand-600`), but the pixels it paints are resolved at runtime from
 * whatever `<html data-branch="...">` is currently set to.
 *
 * Because the triplet is bare, `<alpha-value>` keeps working — so `bg-brand-600/10`,
 * `ring-accent/40` and friends all behave exactly like stock Tailwind colours.
 *
 *   data-branch="win"     -> deep navy   #211c51 + orange accent
 *   data-branch="pwint"   -> white theme + fuchsia/magenta accent
 *   data-branch="yangon"  -> red theme   + white accent
 *   data-branch="house"   -> neutral (admin, "All branches")
 *
 * Dark mode is an orthogonal `.dark` class on the same element, so the two
 * multiply: 4 branches x 2 modes = 8 palettes, zero extra utility classes.
 * All token values live in src/index.css.
 */

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const channel = (token) => `rgb(var(${token}) / <alpha-value>)`;

/** Expand `--brand-50 … --brand-950` into a Tailwind colour scale. */
const ramp = (name) =>
  Object.fromEntries(STEPS.map((step) => [step, channel(`--${name}-${step}`)]));

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ---- Branch-reactive ------------------------------------------- */
        brand: {
          ...ramp('brand'),
          DEFAULT: channel('--brand-600'),
          /** Brand hue stepped to stay legible as *text* on the page surface. */
          ink: channel('--brand-ink'),
          /** Text/icon colour that sits on top of a brand-600 fill. */
          on: channel('--brand-on'),
        },
        accent: {
          ...ramp('accent'),
          DEFAULT: channel('--accent-500'),
          ink: channel('--accent-ink'),
          on: channel('--accent-on'),
        },

        /* ---- Surfaces & ink -------------------------------------------- */
        surface: {
          DEFAULT: channel('--surface'),
          card: channel('--surface-card'),
          raised: channel('--surface-raised'),
          sunken: channel('--surface-sunken'),
        },
        ink: {
          DEFAULT: channel('--ink'),
          muted: channel('--ink-muted'),
          subtle: channel('--ink-subtle'),
        },
        line: {
          DEFAULT: channel('--line'),
          strong: channel('--line-strong'),
        },

        /* ---- Fixed semantics ------------------------------------------- *
         * Deliberately NOT branch-reactive: "late" and "overtime" must mean
         * the same thing in every shop, and a status colour that changed hue
         * per branch would be unreadable as a status.                       */
        ok: { DEFAULT: channel('--ok'), ink: channel('--ok-ink'), soft: channel('--ok-soft') },
        warn: { DEFAULT: channel('--warn'), ink: channel('--warn-ink'), soft: channel('--warn-soft') },
        danger: { DEFAULT: channel('--danger'), ink: channel('--danger-ink'), soft: channel('--danger-soft') },
        /** Overtime. Orange everywhere, on purpose. */
        ot: { DEFAULT: channel('--ot'), ink: channel('--ot-ink'), soft: channel('--ot-soft') },

        /* ---- Data-visualisation ---------------------------------------- *
         * Validated palette — see docs/ATTENDANCE_ARCHITECTURE.md.          */
        viz: {
          1: channel('--viz-1'),
          2: channel('--viz-2'),
          muted: channel('--viz-muted'),
          grid: channel('--viz-grid'),
          axis: channel('--viz-axis'),
        },
      },

      fontFamily: {
        /* Noto Sans Myanmar sits in the same stack rather than behind a
           language class: a screen mixes both scripts constantly — an English
           label above a Burmese name — and the browser picks per glyph. */
        sans: [
          '"Plus Jakarta Sans"',
          '"Noto Sans Myanmar"',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'sans-serif',
        ],
      },

      borderRadius: { '4xl': '1.75rem', '5xl': '2.25rem' },

      /* Soft, layered, low-opacity shadows — never a single hard drop. */
      boxShadow: {
        soft: '0 1px 2px rgb(var(--shadow) / 0.05), 0 4px 14px -2px rgb(var(--shadow) / 0.07)',
        lift: '0 2px 4px rgb(var(--shadow) / 0.04), 0 14px 40px -8px rgb(var(--shadow) / 0.14)',
        float: '0 4px 8px rgb(var(--shadow) / 0.05), 0 28px 64px -16px rgb(var(--shadow) / 0.22)',
        glow: '0 0 0 1px rgb(var(--brand-500) / 0.16), 0 10px 36px -8px rgb(var(--brand-500) / 0.34)',
        'glow-ot': '0 0 0 1px rgb(var(--ot) / 0.22), 0 10px 36px -8px rgb(var(--ot) / 0.40)',
        hairline: 'inset 0 0 0 1px rgb(var(--line) / 1)',
      },

      backdropBlur: { xs: '2px' },

      transitionTimingFunction: {
        expo: 'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: { 400: '400ms', 600: '600ms' },

      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'none' },
        },
        /* Radar sweep behind the geofence indicator. */
        ping_ring: {
          '0%': { transform: 'scale(0.85)', opacity: '0.55' },
          '80%, 100%': { transform: 'scale(2)', opacity: '0' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        shake: {
          '10%, 90%': { transform: 'translateX(-2px)' },
          '30%, 70%': { transform: 'translateX(4px)' },
          '50%': { transform: 'translateX(-4px)' },
        },
        'draw-in': { from: { strokeDashoffset: '1' }, to: { strokeDashoffset: '0' } },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-in': 'scale-in 0.24s cubic-bezier(0.16, 1, 0.3, 1) both',
        ring: 'ping_ring 2.4s cubic-bezier(0, 0, 0.2, 1) infinite',
        shimmer: 'shimmer 1.8s infinite',
        shake: 'shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97) both',
      },
    },
  },

  plugins: [
    /**
     * Glassmorphism, as three composable primitives rather than a pile of
     * utilities repeated at every call site. Each reads the *branch's* glass
     * tokens, so the frost picks up a navy / fuchsia / red cast automatically.
     */
    ({ addComponents, addUtilities }) => {
      addComponents({
        '.glass': {
          backgroundColor: 'rgb(var(--glass) / var(--glass-alpha))',
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          borderWidth: '1px',
          borderColor: 'rgb(var(--glass-line) / var(--glass-line-alpha))',
        },
        '.glass-strong': {
          backgroundColor: 'rgb(var(--glass) / calc(var(--glass-alpha) + 0.18))',
          backdropFilter: 'blur(28px) saturate(200%)',
          WebkitBackdropFilter: 'blur(28px) saturate(200%)',
          borderWidth: '1px',
          borderColor: 'rgb(var(--glass-line) / var(--glass-line-alpha))',
        },
        /* Hairline highlight along the top edge — the detail that stops a
           frosted panel from looking like flat translucent grey. */
        '.glass-sheen': {
          position: 'relative',
          isolation: 'isolate',
          '&::before': {
            content: '""',
            position: 'absolute',
            insetInline: '0',
            top: '0',
            height: '1px',
            background:
              'linear-gradient(90deg, transparent, rgb(var(--glass-line) / var(--sheen-alpha)), transparent)',
            pointerEvents: 'none',
          },
        },
      });

      addUtilities({
        /* Ambient branch-tinted wash used behind kiosk / dashboard shells. */
        '.bg-aurora': {
          backgroundImage: `
            radial-gradient(60rem 40rem at 12% -10%, rgb(var(--brand-500) / 0.16), transparent 60%),
            radial-gradient(45rem 35rem at 95% 8%, rgb(var(--accent-500) / 0.14), transparent 60%),
            radial-gradient(50rem 40rem at 50% 110%, rgb(var(--brand-700) / 0.12), transparent 60%)
          `,
        },
        '.text-balance': { textWrap: 'balance' },
        '.tap-none': { WebkitTapHighlightColor: 'transparent' },
      });
    },
  ],
};
