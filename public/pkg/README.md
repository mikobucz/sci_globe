# MathMap CLI Cheatsheet

## 1. Budowanie i Serwer

```bash
# Kompilacja binarki CLI (w trybie release dla pelnej wydajnosci)
cargo build --release --bin mathmap-cli

# Przebudowanie silnika WebAssembly dla przegladarki
wasm-pack build --target web --out-dir public/pkg --release

# Uruchomienie serwera z synchronizacja presetow (http://localhost:3000)
python3 serve.py

# Uruchomienie automatycznych testow jednostkowych i zbieznosci fizyki
cargo test --release
```

## 2. Presety z Przegladarki

```bash
# Wypisz wszystkie zapisane presety z public/presets.json oraz wbudowane
./target/release/mathmap-cli --list-presets

# Odpal diagnostyke na swoim zapisanym presecie (tylko polaczone artykuly)
./target/release/mathmap-cli --preset "test 3" --only-connected --seed 42
```

## 3. Kartografia Wysp i Archipelagow (`--islands`)

```bash
# Wykryj i przeanalizuj wszystkie wyspy (domyslnie >= 5 wezlow) dla swojego presetu
./target/release/mathmap-cli --preset "test 3" --only-connected --seed 42 --islands

# Pokaz tylko wieksze kontynenty/wyspy (np. minimum 15 wezlow na wyspe)
./target/release/mathmap-cli --preset "test 3" --only-connected --seed 42 --islands --min-island 15

# Pokaz nawet najmniejsze mikro-wyspy (od 3 wezlow wzwyz)
./target/release/mathmap-cli --preset "test 3" --only-connected --seed 42 --islands --min-island 3
```

## 4. Eksperymenty i Nadpisywanie Parametrow

Mozesz zaladowac dowolny `--preset`, a nastepnie nadpisac pojedyncze parametry z linii komend:

```bash
# Preset "test 3", ale ze zwiekszonym przyciaganiem linkow i stopniem normalizacji lisci
./target/release/mathmap-cli --preset "test 3" --only-connected --link-str 1.2 --deg-norm 0.85 --islands

# Czysta symulacja bottom-up od zera (bez kotwic i bez kohezji) na 1000 krokow
./target/release/mathmap-cli --preset pure --only-connected --steps 1000 --islands

# Inspekcja 10 losowych prac i ich najblizszych sasiadow na sferze 3D
./target/release/mathmap-cli --preset "test (goat preset)" --only-connected --inspect 10

# Eksport pelnego raportu diagnostycznego i profilera CPU do pliku JSON
./target/release/mathmap-cli --preset "test 3" --only-connected --dump-json report.json
```

## 5. Wszystkie Flagi `mathmap-cli`

| Flaga | Opis |
| :--- | :--- |
| `--preset <NAZWA>` | Laduje preset z `public/presets.json` (lub wbudowany: `default`, `pure`, `cohesion`) |
| `--list-presets` | Wypisuje dostepne presety i konczy dzialanie |
| `--islands` | Uruchamia kartograf wysp (klastry przestrzenne 3D, czystosc, słowa kluczowe, mosty) |
| `--min-island <N>` | Minimalny rozmiar wyspy do wyswietlenia w raporcie (domyslnie `5`) |
| `--only-connected` | Filtruje graf tylko do artykulow posiadajacych cytowania (`deg > 0`) |
| `--all-nodes` | Wlacza rowniez artykuly bez zadnych cytowan (`deg == 0`) |
| `--steps <N>` | Liczba klatek symulacji przed pomiarem (domyslnie `700`) |
| `--seed <N>` | Ziarno RNG dla w pelni powtarzalnego układu poczatkowego (np. `--seed 42`) |
| `--inspect <N>` | Liczba pojedynczych wezlow do szczegolowej inspekcji sasiadow (domyslnie `5`) |
| `--anchor <F>` | Nadpisuje sile kotwic dziedzinowych (`anchor_strength`) |
| `--cohesion <F>` | Nadpisuje kohezje tej samej dziedziny (`field_cohesion`) |
| `--nebula <F>` | Nadpisuje odpychanie innych dziedzin (`nebula_repulsion`) |
| `--link-str <F>` | Nadpisuje sile przyciagania cytowan (`link_strength`) |
| `--deg-norm <F>` | Nadpisuje wyrownanie szans dla lisci (`degree_norm`) |
| `--pbd <F>` | Nadpisuje twardosc kolizji XPBD (`pbd_stiffness`) |
| `--dump-json <PLIK>` | Zapisuje surowe metryki do pliku JSON |

