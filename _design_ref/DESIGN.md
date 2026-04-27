# Design System Documentation: The Mathematical Blueprint

## 1. Overview & Creative North Star
**Creative North Star: The Precision Architect**
This design system moves beyond "Operational Trust" as a concept and manifests it as a physical reality. It is an editorial experience that marries the clinical precision of a physics laboratory with the high-end luxury of a Swiss horology house. 

To break the "template" look, we utilize **Mathematical Asymmetry**. Layouts are not built on rigid, centered grids but are weighted according to the golden ratio. We use overlapping elements—typography bleeding into diagrams, and "glass" layers resting over intricate golden spirals—to create a sense of three-dimensional technical depth. The interface should feel like a living blueprint: authoritative, intentional, and impeccably organized.

---

## 2. Colors: Tonal Architecture
The palette is dominated by "Stark White" and "Royal Blue," but the sophistication lies in the nuanced tiers of neutral surfaces.

### The "No-Line" Rule
**Strict Mandate:** 1px solid borders for sectioning are prohibited. Boundaries must be defined solely through background color shifts. Use `surface-container-low` (#f3f4f5) sections to house content sitting on a `surface` (#f8f9fa) background. This creates a "milled" look, as if the UI was carved from a single block of material rather than assembled with lines.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers:
*   **Base:** `surface` (#f8f9fa)
*   **Secondary Content:** `surface-container-low` (#f3f4f5)
*   **Elevated Modules:** `surface-container-lowest` (#ffffff) for maximum "pop" against the off-white base.
*   **Deep Contrast:** `primary-container` (#0019a8) is reserved for high-impact editorial moments, housing `on-primary` text.

### The "Glass & Golden Gradient" Rule
To bridge the technical diagrams with the UI, use semi-transparent `surface` colors with a 12px-20px backdrop-blur. For the Fibonacci visuals, utilize a subtle gradient transition from `secondary` (#795900) to `secondary-container` (#fcc340) to simulate etched gold or brass against the royal blue.

---

## 3. Typography: Editorial Authority
The typography system utilizes **Plus Jakarta Sans** for its geometric clarity and **Space Grotesk** for technical labels to provide a "coding" aesthetic.

*   **Display (Large/Medium):** `display-lg` (3.5rem) should be used for hero statements. Tighten letter-spacing to -0.02em for a high-fashion, editorial feel.
*   **The Technical Label:** `label-md` (Space Grotesk, 0.75rem) is used for mathematical annotations. These should often be paired with the physics-inspired diagrams, using `on-surface-variant` (#454654) to mimic blueprint ink.
*   **Body Copy:** `body-lg` (1rem) is the workhorse. Maintain a generous 1.6 line-height to ensure the "Stark White" background feels like "Breathing Room" rather than "Empty Space."

---

## 4. Elevation & Depth: The Layering Principle
Depth is achieved through **Tonal Layering** and **Ambient Light**, never through heavy drop shadows.

*   **Tonal Stacking:** Place a `surface-container-lowest` (#ffffff) card on a `surface-container-low` (#f3f4f5) background. The 24px (`md`: 1.5rem) or 32px (`lg`: 2rem) corner radius provides the "object" feel.
*   **Ambient Shadows:** If a floating state is required (e.g., a modal or dropdown), use a shadow with a 40px blur, 0% spread, and 6% opacity. Use the `primary` (#000d6e) color for the shadow tint to keep it "on-brand" and natural.
*   **The Ghost Border Fallback:** For interactive elements like input fields, use `outline-variant` (#c5c5d6) at 20% opacity. It should be felt, not seen.

---

## 5. Components: The Refined Toolkit

### Buttons: The Tactile Driver
*   **Primary:** `primary-container` (#0019a8) background with `on-primary` text. Use a 24px (`md`) corner radius. Apply a subtle linear gradient (Top-Down) from #0019A8 to #000d6e for a "physical button" depth.
*   **Secondary:** `surface-container-highest` background. No border.
*   **Interactive State:** On hover, primary buttons should shift to `on-primary-fixed-variant` (#2234b9).

### Cards & Lists: The Infinite Flow
*   **Constraint:** Forbid the use of divider lines.
*   **Separation:** Use a 32px vertical spacing (`xl` scale) or a slight shift to `surface-container-low` to separate list items.
*   **Fibonacci Containers:** When displaying the Fibonacci visual, the container should use a `secondary_fixed` (#ffdea0) accent as a hairline "ghost border" to highlight the mathematical precision.

### Physics-Inspired Inputs
*   **Text Inputs:** Use `surface-container-lowest` (#ffffff). Labels must use `label-md` (Space Grotesk) positioned above the field, mimicking a technical schematic.
*   **Checkboxes/Radios:** When active, these should use `primary` (#000d6e). The "Unchecked" state is a "Ghost Border" of `outline-variant` at 30% opacity.

---

## 6. Do’s and Don'ts

### Do:
*   **Embrace Asymmetry:** Align a headline to the left and a Fibonacci diagram to the far right, leaving a "void" in the center to emphasize the golden ratio.
*   **Use Mathematical Annotations:** Use small `label-sm` text (Space Grotesk) to label sections with decimal coordinates (e.g., "SECTION_01 // 1.618").
*   **Layer with Purpose:** Allow physics diagrams to sit *underneath* text layers with a 20% opacity to create a sense of depth.

### Don't:
*   **Don't use 1px borders:** It breaks the "milled/sculpted" feel of the interface.
*   **Don't use pure black:** Use `on-background` (#191c1d) for text to maintain a premium, ink-like softness against the stark white.
*   **Don't crowd the canvas:** If a layout feels full, remove an element. This design system relies on the luxury of "Negative Space."