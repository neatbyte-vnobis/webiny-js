import React, { useCallback, useState, useEffect } from "react";
import { setContext } from "apollo-link-context";
import { useApolloClient } from "@apollo/react-hooks";
import { Security } from "@okta/okta-react";
import { OktaAuth, toRelativeUrl, AuthStateManager } from "@okta/okta-auth-js";
import { plugins } from "@webiny/plugins";
import { useHistory } from "@webiny/react-router";
import { CircularProgress } from "@webiny/ui/Progress";
import { SecurityIdentity, useSecurity } from "@webiny/app-security";
import { ApolloLinkPlugin } from "@webiny/app/plugins/ApolloLinkPlugin";
import "@okta/okta-signin-widget/dist/css/okta-sign-in.min.css";

import OktaSignInWidget from "./OktaSignInWidget";

export interface AuthenticationProps {
    getIdentityData: any;
    oktaAuth: OktaAuth;
    oktaSignIn?: any;
    children: any;
}

export const Authentication = ({
    getIdentityData,
    oktaAuth,
    oktaSignIn,
    children
}: AuthenticationProps) => {
    const apolloClient = useApolloClient();
    const { identity, setIdentity } = useSecurity();
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    const history = useHistory();

    const restoreOriginalUri = async (_oktaAuth, originalUri) => {
        history.replace(toRelativeUrl(originalUri || "/", window.location.origin));
    };

    useEffect(() => {
        plugins.register(
            new ApolloLinkPlugin(() => {
                return setContext(async (_, { headers }) => {
                    // If "Authorization" header is already set, don't overwrite it.
                    if (headers && headers.Authorization) {
                        return { headers };
                    }

                    const idToken = oktaAuth.getIdToken();

                    if (!idToken) {
                        return { headers };
                    }

                    return {
                        headers: {
                            ...headers,
                            Authorization: `Bearer ${idToken}`
                        }
                    };
                });
            })
        );
    }, []);

    const authStateChanged = useCallback(async authState => {
        setIsAuthenticated(authState.isAuthenticated);
        if (authState.isAuthenticated) {
            try {
                const { login, ...data } = await getIdentityData({
                    client: apolloClient,
                    payload: authState.idToken
                });

                setIdentity(
                    new SecurityIdentity({
                        login,
                        ...data,
                        logout() {
                            oktaAuth.signOut();
                            setIdentity(null);
                        }
                    })
                );
            } catch(err) {
                console.log(err);
            }
        } else {
            // Unset identity
            setIdentity(null);
        }
    }, []);

    useEffect(() => {
        const authStateManager: AuthStateManager = oktaAuth.authStateManager;
        authStateManager.subscribe(authStateChanged);

        return () => authStateManager.unsubscribe(authStateChanged);
    }, []);

    return (
        <Security oktaAuth={oktaAuth} restoreOriginalUri={restoreOriginalUri}>
            {identity ? (
                children
            ) : isAuthenticated ? (
                <CircularProgress label={"Checking user..."} />
            ) : (
                <OktaSignInWidget oktaSignIn={oktaSignIn} />
            )}
        </Security>
    );
};