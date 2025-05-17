<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';

    const AUTH_SERVICE_BASE_URL = 'http://localhost:4500';

    let currentUsername = null; 
    let authToken = null;

    let showLogin = true; 
    let showRegister = false;

    let loginUsername = '';
    let loginPassword = '';
    let loginError = null;

    let regUsername = '';
    let regPassword = '';
    let regError = null;
    let regSuccess = null;

    onMount(() => {
        // ✅ Fix: nu redeclara cu const
        authToken = localStorage.getItem('authToken');
        currentUsername = localStorage.getItem('currentUsername');
        if (authToken && currentUsername) {
            goto('/search', { replaceState: true });
        }
    });

    function switchToRegister() {
        showLogin = false;
        showRegister = true;
        clearAuthErrors();
    }

    function switchToLogin() {
        showLogin = true;
        showRegister = false;
        clearAuthErrors();
    }

    function clearAuthErrors() {
        loginError = null;
        regError = null;
        regSuccess = null;
    }

    async function handleRegister() {
        regError = null;
        regSuccess = null;
        try {
            const response = await fetch(`${AUTH_SERVICE_BASE_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: regUsername, password: regPassword }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Registration failed');
            }
            regSuccess = data.message + " Please login.";
            regUsername = '';
            regPassword = '';
        } catch (err) {
            regError = err.message;
        }
    }

    async function handleLogin() {
        loginError = null;
        try {
            const response = await fetch(`${AUTH_SERVICE_BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: loginUsername, password: loginPassword }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Login failed');
            }
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('currentUsername', data.username);
            goto('/search', { replaceState: true });
        } catch (err) {
            loginError = err.message;
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUsername');
        }
    }
</script>

<main class="container">
    {#if !authToken}
        {#if showLogin}
            <section class="auth-section">
                <h2>Autentificare</h2>
                <form on:submit|preventDefault={handleLogin}>
                    <div>
                        <label for="loginUser">Utilizator:</label>
                        <input type="text" id="loginUser" bind:value={loginUsername} required />
                    </div>
                    <div>
                        <label for="loginPass">Parolă:</label>
                        <input type="password" id="loginPass" bind:value={loginPassword} required />
                    </div>
                    <button type="submit">Login</button>
                    {#if loginError}
                        <p class="error">{loginError}</p>
                    {/if}
                </form>
                <p>Nu ai cont? <button type="button" class="link-button" on:click={switchToRegister}>Înregistrează-te</button></p>
            </section>
        {/if}

        {#if showRegister}
            <section class="auth-section">
                <h2>Înregistrare</h2>
                <form on:submit|preventDefault={handleRegister}>
                    <div>
                        <label for="regUser">Utilizator:</label>
                        <input type="text" id="regUser" bind:value={regUsername} required />
                    </div>
                    <div>
                        <label for="regPass">Parolă:</label>
                        <input type="password" id="regPass" bind:value={regPassword} required />
                    </div>
                    <button type="submit">Înregistrează-te</button>
                    {#if regError}
                        <p class="error">{regError}</p>
                    {/if}
                    {#if regSuccess}
                        <p class="success">{regSuccess}</p>
                    {/if}
                </form>
                <p>Ai deja cont? <button type="button" class="link-button" on:click={switchToLogin}>Autentifică-te</button></p>
            </section>
        {/if}
    {:else}
        <!-- Fallback UI în cazul în care onMount nu redirecționează -->
        <p>Se redirecționează...</p>
    {/if}
</main>

<style>
    .container { max-width: 600px; margin: 2em auto; padding: 1em; font-family: Arial, sans-serif; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9; }
    .auth-section { background-color: #fff; padding: 20px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h2 { color: #333; text-align: center; margin-bottom: 1.5em; }
    div { margin-bottom: 1em; }
    label { display: block; margin-bottom: 0.5em; color: #555; font-weight: bold; }
    input[type="text"], input[type="password"] { width: calc(100% - 22px); padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
    button { background-color: #007bff; color: white; padding: 10px 15px; border: none; border-radius: 4px; cursor: pointer; font-size: 1em; }
    button:hover { background-color: #0056b3; }
    .link-button { background: none; border: none; color: #007bff; text-decoration: underline; cursor: pointer; padding: 0; font-size: 0.9em; }
    .link-button:hover { color: #0056b3; }
    .error { color: #d9534f; background-color: #f2dede; border: 1px solid #ebccd1; padding: 10px; border-radius: 4px; margin-top: 1em; }
    .success { color: #3c763d; background-color: #dff0d8; border: 1px solid #d6e9c6; padding: 10px; border-radius: 4px; margin-top: 1em; }
</style>
