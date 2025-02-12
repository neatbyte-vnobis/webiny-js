import React from "react";
import { IconButton } from "@webiny/ui/Button";
import { ReactComponent as MenuIcon } from "./icons/hamburger.svg";
import { useNavigation } from "./index";
import { useTags } from "@webiny/app-admin";

const Hamburger: React.FC = () => {
    const { location } = useTags();
    const { visible, setVisible } = useNavigation();

    return (
        <IconButton
            icon={<MenuIcon style={{ color: location === "navigation" ? undefined : "white" }} />}
            onClick={() => setVisible(!visible)}
            data-testid={location === "navigation" ? undefined : "apps-menu"}
        />
    );
};

export default Hamburger;
