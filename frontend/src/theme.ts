import { alpha, createTheme } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";

import { digitsFontFace } from "./ui/fonts";
import { ease, fonts, tokensFor } from "./ui/tokens";
import type { ColorMode } from "./ui/tokens";

// RMIS spatial design language — "Obsidian Aurora" (dark) / "Porcelain Aurora" (light).
// Every MUI component used across the app is restyled here, so pages/dialogs pick the
// look up without any change to their own code. Companion global rules: ui/spatial.css
// (which switches on <html data-theme>). The active mode comes from ColorModeProvider.

/** Mode-specific surface recipes (glass fills, hairlines, shadows, control tints). */
function surfacesFor(mode: ColorMode) {
  if (mode === "dark") {
    return {
      glass: "rgba(13, 19, 44, 0.52)",
      glassRaised: "rgba(16, 23, 52, 0.72)",
      glassSolid: "rgba(10, 15, 36, 0.94)",
      faint: "rgba(255,255,255,0.025)",
      sheen: "rgba(255,255,255,0.045)",
      highlight: "inset 0 1px 0 0 rgba(255,255,255,0.06)",
      cardShadow: "0 24px 60px -30px rgba(0,0,0,0.9)",
      deepShadow: "0 30px 80px -24px rgba(0,0,0,0.85)",
      input: "rgba(4, 7, 20, 0.55)",
      inputFocus: "rgba(10, 14, 36, 0.8)",
      inputBorder: "rgba(148,163,255,0.16)",
      inputBorderHover: "rgba(148,163,255,0.38)",
      neutralTint: "rgba(238,241,255,0.07)",
      neutralBorder: "rgba(238,241,255,0.1)",
      neutralOutline: "rgba(238,241,255,0.18)",
      control: "rgba(238,241,255,0.35)",
      track: "rgba(238,241,255,0.18)",
      tableContainer: "rgba(4,7,20,0.35)",
      tableHead: "rgba(10, 15, 36, 0.85)",
      stickyHead: "rgba(10, 15, 36, 0.92)",
      scrim: "rgba(2, 3, 10, 0.62)",
      drawer: "rgba(7, 10, 26, 0.82)",
      drawerShadow: "0 0 120px -20px rgba(0,0,0,0.9)",
      skeleton: "rgba(238,241,255,0.06)",
      disabledText: "rgba(238,241,255,0.5)",
      disabledBg: "rgba(238,241,255,0.07)",
      contrastInk: "#ffffff", // the "neutral" ink used by outlined/text color="inherit" buttons
      tabSelected: "#ffffff",
      link: "#B0A5FF",
      // Inverted ramp: components that still reference grey.50/100/300 for "subtle
      // surface" backgrounds render as dark glass instead of light panels.
      grey: {
        50: "#0E1430", 100: "#121a3a", 200: "#182245", 300: "#222d55", 400: "#3a4570",
        500: "#6c7699", 600: "#8f99bd", 700: "#b4bcdb", 800: "#d6dcf2", 900: "#eef1ff",
      },
    };
  }
  return {
    glass: "rgba(255, 255, 255, 0.62)",
    glassRaised: "rgba(255, 255, 255, 0.84)",
    glassSolid: "rgba(255, 255, 255, 0.97)",
    faint: "rgba(255,255,255,0.55)",
    sheen: "rgba(255,255,255,0.75)",
    highlight: "inset 0 1px 0 0 rgba(255,255,255,0.95)",
    cardShadow: "0 24px 60px -34px rgba(30, 38, 96, 0.30)",
    deepShadow: "0 30px 80px -28px rgba(30, 38, 96, 0.38)",
    input: "rgba(255, 255, 255, 0.78)",
    inputFocus: "#FFFFFF",
    inputBorder: "rgba(30,38,96,0.16)",
    inputBorderHover: "rgba(30,38,96,0.34)",
    neutralTint: "rgba(30,38,96,0.06)",
    neutralBorder: "rgba(30,38,96,0.10)",
    neutralOutline: "rgba(30,38,96,0.22)",
    control: "rgba(30,38,96,0.42)",
    track: "rgba(30,38,96,0.22)",
    tableContainer: "rgba(255,255,255,0.5)",
    tableHead: "rgba(246, 247, 253, 0.94)",
    stickyHead: "rgba(246, 247, 253, 0.97)",
    scrim: "rgba(18, 22, 58, 0.26)",
    drawer: "rgba(250, 251, 255, 0.86)",
    drawerShadow: "0 0 120px -20px rgba(30, 38, 96, 0.35)",
    skeleton: "rgba(30,38,96,0.06)",
    disabledText: "rgba(11,16,48,0.38)",
    disabledBg: "rgba(11,16,48,0.06)",
    contrastInk: "#0B1030",
    tabSelected: "#0B1030",
    link: "#5A44EC",
    grey: {
      50: "#F7F8FC", 100: "#EEF0F7", 200: "#E2E5F0", 300: "#CDD2E3", 400: "#A9B0C8",
      500: "#7D84A6", 600: "#5A6187", 700: "#3F466B", 800: "#262C4D", 900: "#0B1030",
    },
  };
}

type Tone = "primary" | "secondary" | "error" | "warning" | "info" | "success";
const TONES: Tone[] = ["primary", "secondary", "error", "warning", "info", "success"];

const toneOf = (theme: Theme, color: unknown) =>
  TONES.includes(color as Tone) ? theme.palette[color as Tone].main : null;

/** Builds the full RMIS theme for one color mode. */
export function createAppTheme(mode: ColorMode): Theme {
  const { ink, neon, gradients } = tokensFor(mode);
  const sf = surfacesFor(mode);
  const isDark = mode === "dark";
  const glass = { blur: "blur(22px) saturate(160%)" };
  const hairline = `1px solid ${ink.line}`;
  const innerHighlight = sf.highlight;
  const deepShadow = sf.deepShadow;

  return createTheme({
    direction: "rtl",
    palette: {
      mode,
      primary: {
        main: neon.violet,
        light: isDark ? "#B0A5FF" : "#8B7BFF",
        dark: neon.violetDeep,
        contrastText: isDark ? "#0A0620" : "#FFFFFF",
      },
      secondary: {
        main: neon.cyan,
        light: isDark ? "#7FF3E8" : "#2EE6D6",
        dark: isDark ? "#13A89C" : "#077F74",
        contrastText: isDark ? "#02110F" : "#FFFFFF",
      },
      error: { main: neon.critical, contrastText: isDark ? "#1A020A" : "#FFFFFF" },
      warning: { main: neon.medium, contrastText: "#1E1400" },
      info: { main: neon.sky, contrastText: isDark ? "#021320" : "#FFFFFF" },
      success: { main: neon.low, contrastText: isDark ? "#01170F" : "#FFFFFF" },
      background: { default: ink.void, paper: ink.midnight },
      text: { primary: ink.text, secondary: ink.textDim, disabled: ink.textMute },
      divider: ink.line,
      action: {
        hover: alpha(neon.violet, 0.08),
        selected: alpha(neon.violet, 0.15),
        focus: alpha(neon.violet, 0.2),
        disabled: isDark ? "rgba(238, 241, 255, 0.28)" : "rgba(11, 16, 48, 0.3)",
        disabledBackground: sf.disabledBg,
      },
      grey: sf.grey,
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: fonts.body,
      h1: { fontFamily: fonts.display, fontWeight: 800, letterSpacing: "-0.04em" },
      h2: { fontFamily: fonts.display, fontWeight: 800, letterSpacing: "-0.035em" },
      h3: { fontFamily: fonts.display, fontWeight: 800, letterSpacing: "-0.03em" },
      h4: { fontFamily: fonts.numeric, fontWeight: 800, letterSpacing: "-0.03em" },
      h5: { fontFamily: fonts.numeric, fontWeight: 700, letterSpacing: "-0.02em" },
      h6: { fontFamily: fonts.numeric, fontWeight: 700, letterSpacing: "-0.01em" },
      subtitle1: { fontWeight: 600, letterSpacing: "-0.005em" },
      subtitle2: { fontFamily: fonts.display, fontWeight: 600, letterSpacing: "0.005em" },
      body1: { letterSpacing: "0.003em" },
      body2: { letterSpacing: "0.005em", lineHeight: 1.6 },
      caption: { letterSpacing: "0.02em" },
      overline: { fontFamily: fonts.mono, fontWeight: 600, letterSpacing: "0.24em" },
      button: { fontFamily: fonts.display, fontWeight: 600, letterSpacing: "0.01em", textTransform: "none" },
    },
    transitions: {
      easing: {
        easeInOut: ease.inOut,
        easeOut: ease.out,
        easeIn: "cubic-bezier(0.7, 0, 0.84, 0)",
        sharp: ease.out,
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: `
          ${digitsFontFace}
          body {
            background-color: ${ink.void};
            color: ${ink.text};
          }
          b, strong { font-weight: 700; }
        `,
      },

      // ---- Surfaces ----------------------------------------------------------
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: "none",
            backgroundColor: sf.glass,
            border: hairline,
            boxShadow: innerHighlight,
          },
          outlined: {
            backgroundColor: sf.faint,
            borderColor: ink.line,
          },
        },
      },
      MuiCard: {
        defaultProps: { variant: "outlined" },
        styleOverrides: {
          root: {
            position: "relative",
            isolation: "isolate",
            overflow: "hidden",
            borderRadius: 22,
            backgroundColor: sf.glass,
            backgroundImage:
              `linear-gradient(180deg, ${sf.sheen} 0%, rgba(255,255,255,0) 38%)`,
            border: hairline,
            backdropFilter: glass.blur,
            WebkitBackdropFilter: glass.blur,
            boxShadow: `${innerHighlight}, ${sf.cardShadow}`,
            transition: `transform 0.6s ${ease.out}, box-shadow 0.6s ${ease.out}, border-color 0.6s ${ease.out}`,
            "&:hover": {
              borderColor: ink.lineStrong,
              boxShadow: `${innerHighlight}, 0 40px 90px -40px ${alpha(neon.violetDeep, isDark ? 0.55 : 0.35)}, 0 0 0 1px ${alpha(neon.violet, 0.08)}`,
            },
          },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: {
            padding: "clamp(16px, 1.6vw, 24px)",
            "&:last-child": { paddingBottom: "clamp(16px, 1.6vw, 24px)" },
          },
        },
      },
      MuiCardHeader: {
        styleOverrides: { title: { fontFamily: fonts.display, fontWeight: 700 } },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: "transparent" },
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiToolbar: { styleOverrides: { root: { gap: 8 } } },
      MuiDivider: { styleOverrides: { root: { borderColor: ink.line } } },

      // ---- Buttons -----------------------------------------------------------
      MuiButtonBase: { defaultProps: { disableRipple: false } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: ({ theme, ownerState }) => {
            const tone = toneOf(theme, ownerState.color) ?? neon.violet;
            return {
              position: "relative",
              overflow: "hidden",
              borderRadius: 12,
              paddingInline: 18,
              minHeight: 38,
              whiteSpace: "nowrap",
              transition: `transform 0.45s ${ease.out}, box-shadow 0.45s ${ease.out}, background-color 0.3s, border-color 0.3s, color 0.3s`,
              "&:active": { transform: "translateY(0) scale(0.97)" },
              "&.Mui-disabled": { opacity: 0.6 },
              ...(ownerState.variant === "contained" && {
                color: "#fff",
                backgroundColor: tone,
                backgroundImage:
                  ownerState.color === "primary" || !ownerState.color
                    ? gradients.aurora
                    : `linear-gradient(120deg, ${tone} 0%, ${alpha(tone, 0.72)} 100%)`,
                backgroundSize: "160% 100%",
                backgroundPosition: "0% 50%",
                textShadow: "0 1px 10px rgba(0,0,0,0.35)",
                boxShadow: `0 10px 30px -10px ${alpha(tone, 0.75)}, inset 0 1px 0 rgba(255,255,255,0.35)`,
                "&::after": {
                  content: '""',
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.42) 50%, transparent 70%)",
                  transform: "translateX(-110%)",
                  pointerEvents: "none",
                },
                "&:hover": {
                  backgroundColor: tone,
                  backgroundPosition: "100% 50%",
                  transform: "translateY(-2px)",
                  boxShadow: `0 18px 40px -12px ${alpha(tone, 0.9)}, 0 0 0 1px ${alpha(tone, 0.5)}, inset 0 1px 0 rgba(255,255,255,0.4)`,
                  "&::after": { animation: `rmis-sheen 0.9s ${ease.out}` },
                },
                "&.Mui-disabled": {
                  color: sf.disabledText,
                  backgroundImage: "none",
                  backgroundColor: sf.disabledBg,
                  boxShadow: "none",
                },
              }),
              ...(ownerState.variant === "outlined" && {
                borderColor: alpha(ownerState.color === "inherit" ? sf.contrastInk : tone, 0.32),
                backgroundColor: sf.faint,
                backdropFilter: "blur(10px)",
                "&:hover": {
                  borderColor: ownerState.color === "inherit" ? alpha(sf.contrastInk, 0.6) : tone,
                  backgroundColor: alpha(ownerState.color === "inherit" ? sf.contrastInk : tone, 0.1),
                  transform: "translateY(-2px)",
                  boxShadow: `0 0 0 1px ${alpha(tone, 0.25)}, 0 12px 32px -14px ${alpha(tone, 0.8)}`,
                },
              }),
              ...(ownerState.variant === "text" && {
                "&:hover": {
                  backgroundColor: alpha(ownerState.color === "inherit" ? sf.contrastInk : tone, 0.1),
                  textShadow: `0 0 18px ${alpha(tone, 0.7)}`,
                },
              }),
            };
          },
          sizeSmall: { minHeight: 32, paddingInline: 12, borderRadius: 10, fontSize: "0.8rem" },
          sizeLarge: { minHeight: 48, paddingInline: 24, borderRadius: 14, fontSize: "1rem" },
          startIcon: { marginInlineStart: -2 },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme, ownerState }) => {
            const tone = toneOf(theme, ownerState.color) ?? neon.violet;
            return {
              transition: `transform 0.45s ${ease.out}, background-color 0.3s, box-shadow 0.45s ${ease.out}, color 0.3s`,
              "&:hover": {
                backgroundColor: alpha(tone, 0.14),
                transform: "translateY(-1px) scale(1.08)",
                boxShadow: `0 0 0 1px ${alpha(tone, 0.35)}, 0 0 24px -4px ${alpha(tone, 0.6)}`,
              },
              "&:active": { transform: "scale(0.94)" },
            };
          },
        },
      },
      MuiFab: {
        styleOverrides: {
          root: {
            backgroundImage: gradients.aurora,
            color: "#fff",
            boxShadow: `0 18px 40px -10px ${alpha(neon.violet, 0.8)}, inset 0 1px 0 rgba(255,255,255,0.35)`,
            transition: `transform 0.5s ${ease.spring}, box-shadow 0.5s ${ease.out}`,
            "&:hover": {
              transform: "translateY(-3px) scale(1.06) rotate(-4deg)",
              boxShadow: `0 26px 60px -12px ${alpha(neon.cyan, 0.75)}, inset 0 1px 0 rgba(255,255,255,0.4)`,
            },
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            backgroundColor: sf.faint,
            border: hairline,
            borderRadius: 14,
            padding: 3,
            gap: 3,
          },
          grouped: { border: "0 !important", borderRadius: "11px !important", margin: 0 },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            color: ink.textDim,
            textTransform: "none",
            fontWeight: 600,
            transition: `all 0.4s ${ease.out}`,
            "&:hover": { backgroundColor: alpha(neon.violet, 0.1), color: ink.text },
            "&.Mui-selected": {
              color: "#fff",
              backgroundImage: `linear-gradient(120deg, ${alpha(neon.violet, 0.55)}, ${alpha(neon.cyan, 0.35)})`,
              boxShadow: `0 8px 24px -10px ${alpha(neon.violet, 0.9)}, inset 0 1px 0 rgba(255,255,255,0.2)`,
              "&:hover": { backgroundImage: `linear-gradient(120deg, ${alpha(neon.violet, 0.7)}, ${alpha(neon.cyan, 0.45)})` },
            },
          },
        },
      },

      // ---- Chips, badges, avatars ------------------------------------------
      MuiChip: {
        styleOverrides: {
          root: ({ theme, ownerState }) => {
            const tone = toneOf(theme, ownerState.color);
            const base = {
              fontWeight: 600,
              letterSpacing: "0.01em",
              fontFamily: fonts.numeric,
              borderRadius: 999,
              backdropFilter: "blur(8px)",
              transition: `transform 0.4s ${ease.out}, box-shadow 0.4s ${ease.out}, background-color 0.3s`,
            };
            if (!tone) {
              return {
                ...base,
                ...(ownerState.variant !== "outlined" && {
                  backgroundColor: sf.neutralTint,
                  border: `1px solid ${sf.neutralBorder}`,
                }),
                ...(ownerState.variant === "outlined" && { borderColor: sf.neutralOutline }),
              };
            }
            return {
              ...base,
              color: tone,
              backgroundColor: ownerState.variant === "outlined" ? "transparent" : alpha(tone, 0.13),
              border: `1px solid ${alpha(tone, ownerState.variant === "outlined" ? 0.55 : 0.32)}`,
              boxShadow: `0 0 18px -8px ${alpha(tone, 0.9)}`,
              "& .MuiChip-icon, & .MuiChip-deleteIcon": { color: alpha(tone, 0.85) },
              "& .MuiChip-deleteIcon:hover": { color: tone },
            };
          },
          clickable: {
            "&:hover": { transform: "translateY(-1px)", boxShadow: `0 0 0 1px ${alpha(neon.violet, 0.4)}, 0 8px 22px -8px ${alpha(neon.violet, 0.8)}` },
          },
          sizeSmall: { height: 24, fontSize: "0.72rem" },
        },
      },
      MuiBadge: {
        styleOverrides: {
          badge: {
            fontFamily: fonts.numeric,
            fontWeight: 700,
            boxShadow: `0 0 0 2px ${ink.abyss}, 0 0 14px ${alpha(neon.critical, 0.7)}`,
          },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: {
            fontFamily: fonts.display,
            fontWeight: 700,
            color: "#fff",
            backgroundImage: `linear-gradient(135deg, ${alpha(neon.violet, 0.9)}, ${alpha(neon.cyan, 0.7)})`,
            boxShadow: `0 0 0 1px ${isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.9)"}, 0 6px 18px -6px ${alpha(neon.violet, 0.8)}`,
          },
        },
      },

      // ---- Inputs --------------------------------------------------------------
      MuiTextField: { defaultProps: { variant: "outlined" } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            backgroundColor: sf.input,
            backdropFilter: "blur(10px)",
            transition: `box-shadow 0.4s ${ease.out}, background-color 0.3s`,
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: sf.inputBorder,
              transition: `border-color 0.3s ${ease.out}`,
            },
            "&:hover:not(.Mui-disabled) .MuiOutlinedInput-notchedOutline": { borderColor: sf.inputBorderHover },
            "&.Mui-focused": {
              backgroundColor: sf.inputFocus,
              boxShadow: `0 0 0 4px ${alpha(neon.violet, 0.16)}, 0 0 32px -6px ${alpha(neon.violet, 0.55)}`,
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: neon.violet, borderWidth: 1 },
            "&.Mui-error .MuiOutlinedInput-notchedOutline": { borderColor: neon.critical },
          },
          input: {
            "&:-webkit-autofill": {
              WebkitBoxShadow: `0 0 0 100px ${ink.deep} inset`,
              WebkitTextFillColor: ink.text,
              caretColor: ink.text,
            },
          },
        },
      },
      MuiFilledInput: {
        styleOverrides: {
          root: {
            borderRadius: "14px 14px 0 0",
            backgroundColor: sf.neutralTint,
            "&:hover": { backgroundColor: alpha(sf.contrastInk, 0.07) },
            "&.Mui-focused": { backgroundColor: alpha(sf.contrastInk, 0.06) },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: { color: ink.textDim, "&.Mui-focused": { color: sf.link } },
        },
      },
      MuiFormHelperText: { styleOverrides: { root: { color: ink.textMute } } },
      MuiFormLabel: { styleOverrides: { root: { fontWeight: 600, color: ink.textDim } } },
      MuiSelect: {
        styleOverrides: { icon: { color: ink.textDim } },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: {
            backgroundColor: sf.glassSolid,
            backdropFilter: glass.blur,
            border: `1px solid ${ink.lineStrong}`,
            boxShadow: deepShadow,
            borderRadius: 16,
          },
          option: {
            borderRadius: 10,
            marginInline: 6,
            '&[aria-selected="true"]': { backgroundColor: `${alpha(neon.violet, 0.2)} !important` },
            "&.Mui-focused": { backgroundColor: `${alpha(neon.violet, 0.12)} !important` },
          },
          tag: { margin: 2 },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: { padding: 8 },
          track: {
            borderRadius: 999,
            backgroundColor: sf.track,
            opacity: "1 !important",
            transition: `background-color 0.4s ${ease.out}, box-shadow 0.4s ${ease.out}`,
          },
          thumb: { boxShadow: isDark ? "0 2px 8px rgba(0,0,0,0.5)" : "0 2px 8px rgba(30,38,96,0.3)", backgroundColor: "#fff" },
          switchBase: {
            transition: `transform 0.45s ${ease.spring} !important`,
            "&.Mui-checked + .MuiSwitch-track": {
              backgroundImage: gradients.aurora,
              boxShadow: `0 0 16px -2px ${alpha(neon.violet, 0.8)}`,
            },
          },
        },
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: sf.control,
            "&.Mui-checked": { filter: `drop-shadow(0 0 6px ${alpha(neon.violet, 0.8)})` },
          },
        },
      },
      MuiRadio: {
        styleOverrides: {
          root: {
            color: sf.control,
            "&.Mui-checked": { filter: `drop-shadow(0 0 6px ${alpha(neon.violet, 0.8)})` },
          },
        },
      },
      MuiSlider: {
        styleOverrides: {
          rail: { backgroundColor: sf.track },
          track: { border: 0, backgroundImage: gradients.aurora },
          thumb: {
            backgroundColor: "#fff",
            boxShadow: `0 0 0 4px ${alpha(neon.violet, 0.25)}, 0 0 20px ${alpha(neon.violet, 0.9)}`,
            transition: `box-shadow 0.3s ${ease.out}, transform 0.3s ${ease.spring}`,
            "&:hover, &.Mui-focusVisible": { boxShadow: `0 0 0 8px ${alpha(neon.violet, 0.22)}, 0 0 26px ${alpha(neon.cyan, 0.9)}` },
          },
          valueLabel: {
            fontFamily: fonts.numeric,
            borderRadius: 10,
            backgroundColor: sf.glassSolid,
            border: `1px solid ${ink.lineStrong}`,
          },
        },
      },

      // ---- Tables --------------------------------------------------------------
      MuiTableContainer: {
        styleOverrides: {
          root: {
            borderRadius: 18,
            "&.MuiPaper-root": { backgroundColor: sf.tableContainer },
          },
        },
      },
      MuiTable: { styleOverrides: { root: { borderCollapse: "separate", borderSpacing: 0 } } },
      MuiTableHead: {
        styleOverrides: {
          root: {
            "& .MuiTableCell-head": {
              fontFamily: fonts.display,
              fontSize: "0.72rem",
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: ink.textMute,
              backgroundColor: sf.tableHead,
              backdropFilter: "blur(12px)",
              borderBottom: `1px solid ${ink.lineStrong}`,
              whiteSpace: "nowrap",
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            fontFamily: fonts.numeric,
            borderBottom: `1px solid ${ink.line}`,
            paddingBlock: 13,
          },
          sizeSmall: { paddingBlock: 9 },
          stickyHeader: { backgroundColor: sf.stickyHead },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            transition: `background-color 0.35s ${ease.out}, box-shadow 0.35s ${ease.out}`,
            "&.MuiTableRow-hover:hover": {
              backgroundColor: alpha(neon.violet, 0.07),
              boxShadow: `inset 3px 0 0 ${neon.violet}`,
            },
            "&.Mui-selected, &.Mui-selected:hover": { backgroundColor: alpha(neon.violet, 0.14) },
            "&:last-of-type > .MuiTableCell-body": { borderBottom: 0 },
          },
        },
      },
      MuiTablePagination: {
        styleOverrides: {
          root: { color: ink.textDim, fontFamily: fonts.numeric },
          selectIcon: { color: ink.textDim },
        },
      },
      MuiTableSortLabel: {
        styleOverrides: {
          root: { "&.Mui-active": { color: neon.cyan }, "&:hover": { color: ink.text } },
          icon: { color: `${neon.cyan} !important` },
        },
      },

      // ---- Overlays --------------------------------------------------------------
      MuiBackdrop: {
        styleOverrides: {
          root: {
            "&:not(.MuiBackdrop-invisible)": {
              backgroundColor: sf.scrim,
              backdropFilter: "blur(10px) saturate(120%)",
              WebkitBackdropFilter: "blur(10px) saturate(120%)",
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 26,
            backgroundColor: sf.glassRaised,
            backgroundImage: `radial-gradient(120% 60% at 50% 0%, ${alpha(neon.violet, 0.16)} 0%, transparent 60%)`,
            border: `1px solid ${ink.lineStrong}`,
            backdropFilter: glass.blur,
            WebkitBackdropFilter: glass.blur,
            boxShadow: `${deepShadow}, ${innerHighlight}, 0 0 80px -30px ${alpha(neon.violet, isDark ? 0.6 : 0.35)}`,
            animation: `rmis-dialog-in 0.6s ${ease.out} both`,
          },
          paperFullScreen: { borderRadius: 0 },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            fontFamily: fonts.display,
            fontWeight: 700,
            fontSize: "1.3rem",
            letterSpacing: "-0.015em",
            paddingTop: 22,
            paddingBottom: 12,
          },
        },
      },
      MuiDialogContent: { styleOverrides: { dividers: { borderColor: ink.line } } },
      MuiDialogActions: {
        styleOverrides: { root: { padding: "14px 22px 20px", gap: 8, flexWrap: "wrap" } },
      },
      MuiPopover: {
        styleOverrides: {
          paper: {
            backgroundColor: sf.glassSolid,
            backdropFilter: glass.blur,
            WebkitBackdropFilter: glass.blur,
            border: `1px solid ${ink.lineStrong}`,
            borderRadius: 18,
            boxShadow: `${deepShadow}, 0 0 50px -24px ${alpha(neon.violet, 0.7)}`,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          list: { padding: 6 },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            minHeight: 40,
            transition: `background-color 0.25s ${ease.out}, padding 0.35s ${ease.out}`,
            "&:hover": { backgroundColor: alpha(neon.violet, 0.12), paddingInlineStart: 20 },
            "&.Mui-selected": { backgroundColor: alpha(neon.violet, 0.2) },
          },
        },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
        styleOverrides: {
          tooltip: {
            backgroundColor: "rgba(10, 15, 36, 0.92)",
            backdropFilter: "blur(12px)",
            border: `1px solid ${isDark ? ink.lineStrong : "rgba(11,16,48,0.6)"}`,
            borderRadius: 10,
            padding: "7px 11px",
            fontSize: "0.76rem",
            fontWeight: 500,
            color: "#EEF1FF",
            boxShadow: `0 14px 40px -10px ${isDark ? "rgba(0,0,0,0.9)" : "rgba(30,38,96,0.45)"}, 0 0 24px -10px ${alpha(neon.violet, 0.8)}`,
          },
          arrow: { color: "rgba(10, 15, 36, 0.92)", "&::before": { border: `1px solid ${ink.lineStrong}` } },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: sf.drawer,
            backgroundImage: `radial-gradient(90% 50% at 50% 0%, ${alpha(neon.violet, 0.18)} 0%, transparent 70%)`,
            backdropFilter: "blur(28px) saturate(160%)",
            WebkitBackdropFilter: "blur(28px) saturate(160%)",
            border: 0,
            borderInlineStart: `1px solid ${ink.lineStrong}`,
            boxShadow: sf.drawerShadow,
          },
        },
      },
      MuiSnackbarContent: {
        styleOverrides: {
          root: {
            backgroundColor: sf.glassSolid,
            color: ink.text,
            border: `1px solid ${ink.lineStrong}`,
            backdropFilter: glass.blur,
            borderRadius: 16,
          },
        },
      },

      // ---- Lists ------------------------------------------------------------------
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            marginInline: 8,
            marginBlock: 2,
            transition: `background-color 0.3s ${ease.out}, transform 0.45s ${ease.out}, box-shadow 0.3s`,
            "&:hover": { backgroundColor: alpha(neon.violet, 0.1), transform: "translateX(-3px)" },
            "&.Mui-selected": {
              backgroundColor: alpha(neon.violet, 0.16),
              boxShadow: `inset 3px 0 0 ${neon.violet}, 0 0 24px -12px ${alpha(neon.violet, 0.9)}`,
              "&:hover": { backgroundColor: alpha(neon.violet, 0.22) },
              "& .MuiListItemIcon-root": { color: neon.cyan },
            },
          },
        },
      },
      MuiListItemIcon: { styleOverrides: { root: { minWidth: 38, color: ink.textDim } } },
      MuiListSubheader: {
        styleOverrides: {
          root: {
            backgroundColor: "transparent",
            fontFamily: fonts.mono,
            fontSize: "0.68rem",
            letterSpacing: "0.22em",
            color: ink.textMute,
          },
        },
      },

      // ---- Navigation -----------------------------------------------------------
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: 44 },
          indicator: {
            height: 3,
            borderRadius: 3,
            backgroundImage: gradients.aurora,
            boxShadow: `0 0 14px ${alpha(neon.violet, 0.9)}`,
          },
          flexContainer: { gap: 4 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 44,
            borderRadius: 12,
            textTransform: "none",
            fontFamily: fonts.display,
            fontWeight: 600,
            color: ink.textDim,
            transition: `color 0.3s, background-color 0.3s ${ease.out}`,
            "&:hover": { color: ink.text, backgroundColor: alpha(neon.violet, 0.07) },
            "&.Mui-selected": { color: sf.tabSelected, textShadow: `0 0 18px ${alpha(neon.violet, 0.8)}` },
          },
        },
      },
      MuiStepIcon: {
        styleOverrides: {
          root: {
            color: isDark ? "rgba(238,241,255,0.14)" : "rgba(30,38,96,0.16)",
            "&.Mui-active, &.Mui-completed": { color: neon.violet, filter: `drop-shadow(0 0 8px ${alpha(neon.violet, 0.8)})` },
          },
          text: { fontFamily: fonts.numeric, fontWeight: 700 },
        },
      },
      MuiBreadcrumbs: { styleOverrides: { root: { color: ink.textMute } } },
      MuiLink: {
        styleOverrides: {
          root: {
            color: sf.link,
            textDecorationColor: alpha(neon.violet, 0.4),
            transition: "color 0.25s, text-decoration-color 0.25s",
            "&:hover": { color: neon.cyan, textDecorationColor: neon.cyan },
          },
        },
      },
      MuiPaginationItem: {
        styleOverrides: {
          root: {
            fontFamily: fonts.numeric,
            borderRadius: 10,
            "&.Mui-selected": {
              backgroundImage: gradients.aurora,
              color: "#fff",
              boxShadow: `0 6px 18px -6px ${alpha(neon.violet, 0.9)}`,
            },
          },
        },
      },

      // ---- Feedback -------------------------------------------------------------
      MuiAlert: {
        styleOverrides: {
          root: ({ theme, ownerState }) => {
            const tone = toneOf(theme, ownerState.severity ?? ownerState.color) ?? neon.sky;
            const isFilled = ownerState.variant === "filled";
            return {
              borderRadius: 16,
              alignItems: "center",
              backdropFilter: "blur(14px)",
              border: `1px solid ${alpha(tone, isFilled ? 0.6 : 0.3)}`,
              ...(isFilled
                ? {
                    color: "#fff",
                    backgroundColor: alpha(tone, 0.85),
                    backgroundImage: `linear-gradient(120deg, ${alpha(tone, 0.95)}, ${alpha(tone, 0.6)})`,
                    boxShadow: `0 16px 40px -14px ${alpha(tone, 0.85)}`,
                    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
                  }
                : {
                    color: ink.text,
                    backgroundColor: alpha(tone, 0.08),
                    backgroundImage: `linear-gradient(90deg, ${alpha(tone, 0.14)}, transparent 70%)`,
                    boxShadow: `inset 3px 0 0 ${tone}, 0 0 40px -24px ${alpha(tone, 0.9)}`,
                    "& .MuiAlert-icon": { color: tone, filter: `drop-shadow(0 0 6px ${alpha(tone, 0.8)})` },
                  }),
            };
          },
          message: { lineHeight: 1.55 },
        },
      },
      MuiAlertTitle: { styleOverrides: { root: { fontFamily: fonts.display, fontWeight: 700 } } },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 999, height: 6, backgroundColor: sf.neutralTint },
          bar: ({ theme, ownerState }) => {
            const tone = toneOf(theme, ownerState.color) ?? neon.violet;
            return {
              borderRadius: 999,
              backgroundImage:
                ownerState.color === "primary" || !ownerState.color
                  ? gradients.aurora
                  : `linear-gradient(90deg, ${alpha(tone, 0.7)}, ${tone})`,
              boxShadow: `0 0 12px ${alpha(tone, 0.8)}`,
            };
          },
        },
      },
      MuiCircularProgress: {
        styleOverrides: {
          root: { filter: `drop-shadow(0 0 8px ${alpha(neon.violet, 0.7)})` },
          circle: { strokeLinecap: "round" },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: {
            backgroundColor: sf.skeleton,
            backgroundImage: `linear-gradient(90deg, transparent, ${alpha(neon.violet, 0.12)}, transparent)`,
            backgroundSize: "200% 100%",
            animation: "rmis-shimmer 1.8s linear infinite",
          },
        },
      },

      // ---- Disclosure -----------------------------------------------------------
      MuiAccordion: {
        defaultProps: { disableGutters: true },
        styleOverrides: {
          root: {
            borderRadius: "18px !important",
            backgroundColor: sf.glass,
            backdropFilter: glass.blur,
            marginBottom: 10,
            "&::before": { display: "none" },
            "&.Mui-expanded": { borderColor: ink.lineStrong },
          },
        },
      },
      MuiAccordionSummary: {
        styleOverrides: {
          root: { fontFamily: fonts.display, fontWeight: 600, minHeight: 54 },
          expandIconWrapper: { color: ink.textDim, transition: `transform 0.45s ${ease.out}` },
        },
      },
    },
  });
}

/** Default (dark) theme, kept for callers that don't go through ColorModeProvider. */
export const theme = createAppTheme("dark");
