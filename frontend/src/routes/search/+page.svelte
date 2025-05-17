<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';

    let authToken = null;
    let currentUsername = null;

    let searchName = '';
    let searchType = 'Client';
    let searchResult = null;
    let searchError = null;

    const API_GATEWAY_BASE_URL = 'http://localhost:8000';

    onMount(() => {
        authToken = localStorage.getItem('authToken');
        currentUsername = localStorage.getItem('currentUsername');

        if (!authToken || !currentUsername) {
            goto('/', { replaceState: true });
        }
    });

    async function handleSearch() {
        searchResult = null;
        searchError = null;

        if (!authToken) {
            searchError = 'Autentificare necesară.';
            goto('/', { replaceState: true });
            return;
        }

        try {
            const response = await fetch(`${API_GATEWAY_BASE_URL}/search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify({ name: searchName, type: searchType }),
            });
            const data = await response.json();
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    searchError = `Sesiune expirată sau invalidă: ${data.message || 'Te rog autentifică-te din nou.'}`;
                    localStorage.removeItem('authToken');
                    localStorage.removeItem('currentUsername');
                    authToken = null;
                    currentUsername = null;
                    goto('/', { replaceState: true });
                } else {
                    throw new Error(data.message || `Server error: ${response.status}`);
                }
            } else {
                searchResult = data;
            }
        } catch (err) {
            searchError = `Eroare la căutare: ${err.message}`;
        }
    }

    function handleLogout() {
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUsername');
        authToken = null;
        currentUsername = null;
        goto('/', { replaceState: true });
    }
</script>

<main class="container">
    {#if authToken && currentUsername}
        <section class="search-section">
            <div class="welcome-logout">
                <p>Bine ai venit, {currentUsername}!</p>
                <button on:click={handleLogout}>Logout</button>
            </div>

            <h2>Caută client sau companie</h2>
            <form on:submit|preventDefault={handleSearch}>
                <div>
                    <label for="searchName">Nume:</label>
                    <input id="searchName" type="text" bind:value={searchName} placeholder="Nume client/companie" required />
                </div>
                <div>
                    <label for="searchType">Tip:</label>
                    <select id="searchType" bind:value={searchType}>
                        <option value="Client">Client</option>
                        <option value="Companie">Companie</option>
                    </select>
                </div>
                <button type="submit">Obține informații</button>
            </form>

            {#if searchResult}
                <div class="results">
                    <h3>Rezultat:</h3>
                    {#if searchResult.message && !searchResult.name}
                        <p>{searchResult.message}</p>
                    {:else}
                        <p><strong>Nume:</strong> {searchResult.name}</p>
                        <p><strong>Tip:</strong> {searchResult.type}</p>
                        {#if searchResult.type === 'Client'}
                            <p><strong>Avere deținută:</strong> {searchResult.avere_detinuta}</p>
                            <p><strong>Funcție în companie:</strong> {searchResult.functie_in_companie}</p>
                        {:else if searchResult.type === 'Companie'}
                            <p><strong>Valoare estimată:</strong> {searchResult.valoare_estimata}</p>
                            <p><strong>Număr de angajați:</strong> {searchResult.numar_de_angajati}</p>
                        {/if}
                    {/if}
                </div>
            {/if}

            {#if searchError}
                <p class="error">{searchError}</p>
            {/if}
        </section>
    {:else}
        <p>Se verifică autentificarea...</p>
    {/if}
</main>

<style>
    .container {
        max-width: 600px;
        margin: 2em auto;
        padding: 1em;
        font-family: Arial, sans-serif;
        border: 1px solid #ddd;
        border-radius: 8px;
        background-color: #f9f9f9;
    }

    .search-section {
        background-color: #fff;
        padding: 20px;
        border-radius: 5px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    h2 {
        color: #333;
        text-align: center;
        margin-bottom: 1.5em;
    }

    div {
        margin-bottom: 1em;
    }

    label {
        display: block;
        margin-bottom: 0.5em;
        color: #555;
        font-weight: bold;
    }

    input[type="text"],
    select {
        width: calc(100% - 22px);
        padding: 10px;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-sizing: border-box;
    }

    button {
        background-color: #007bff;
        color: white;
        padding: 10px 15px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 1em;
    }

    button:hover {
        background-color: #0056b3;
    }

    .error {
        color: #d9534f;
        background-color: #f2dede;
        border: 1px solid #ebccd1;
        padding: 10px;
        border-radius: 4px;
        margin-top: 1em;
    }

    .results p {
        background-color: #e9ecef;
        padding: 0.5em 1em;
        border-radius: 4px;
        margin-bottom: 0.5em;
    }

    .welcome-logout {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5em;
        padding-bottom: 1em;
        border-bottom: 1px solid #eee;
    }

    .welcome-logout p {
        margin: 0;
        font-size: 1.1em;
        color: #333;
    }
</style>
