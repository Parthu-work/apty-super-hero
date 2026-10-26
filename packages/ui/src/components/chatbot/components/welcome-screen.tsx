import type { WelcomeScreenProps } from "../../../types";
import { useComponentsContext } from "../context";

/**
 * WelcomeScreen - Renders the app's welcome screen (the emptyState slot or
 * the WelcomeScreen component), or nothing when the app provides none.
 */
export function WelcomeScreen(props: WelcomeScreenProps) {
  const { components, slots } = useComponentsContext();

  if (slots.emptyState) {
    return <>{slots.emptyState(props)}</>;
  }

  const CustomComponent = components.WelcomeScreen;
  if (CustomComponent) {
    return <CustomComponent {...props} />;
  }

  return null;
}
