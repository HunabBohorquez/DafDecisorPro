# DecisorPro — Matriz Ponderada de Decisiones Multicriterio

> **Enlaces del proyecto**

**Link:** ` `

**Repositorio en GitHub:** ` `

> 📝 **Nota:** este proyecto tiene los **mismos archivos** que el repositorio de GitLab
> (`index.html`, `styles.css`, `app.js`, `README.md`). Solo cambia la plataforma de alojamiento.

---

## Descripción del Proyecto

**DecisorPro** es una aplicación web interactiva desarrollada exclusivamente con **HTML5, CSS3 y JavaScript ES6+ Vanilla** (sin frameworks ni dependencias externas) diseñada para resolver problemas de **Análisis de Decisiones Multicriterio (MCDA)** mediante el método de suma ponderada (*Weighted Sum Model*).

### Características principales
- **Gestión Dinámica de Matriz:** permite configurar entre **2 y 6 alternativas** y entre **3 y 8 criterios**, asignando pesos brutos de `1` a `100` con normalización automática al `100%` y calificaciones sincronizadas (`1` a `10`) mediante controles deslizantes e inputs numéricos.
- **Motor de Ranking en Tiempo Real:** calcula puntajes totales en escala `0.00` a `10.00`, ordena las opciones automáticamente y muestra el desglose visual y numérico de puntos aportados por cada criterio.
- **Análisis de Sensibilidad Automático ($\pm 20\%$):** evalúa matemáticamente qué ocurre si el criterio de mayor peso aumenta o disminuye un `20%` (re-normalizando el resto), clasificando la decisión como **Estable** o **Sensible**.
- **Gráfico de Radar Nativo en `<canvas>`:** renderiza dinámicamente $N$ ejes radiales, anillos de escala (`2, 4, 6, 8, 10`), etiquetas con porcentajes normalizados y polígonos semitransparentes interactivos.
- **Persistencia y Exportación:** guarda el estado automáticamente en `localStorage`, incluye un botón **"Cargar Decisión Demo"** y permite exportar la matriz completa en formatos **JSON** y **CSV**.

---

## Modelo Matemático: Normalización y Puntaje Ponderado

### 1. Normalización de Pesos
Dado un conjunto de $M$ criterios con pesos brutos $w_j \in [1, 100]$, el peso normalizado $w_{j,\text{norm}}$ de cada criterio $j$ se calcula como:

$$w_{j,\text{norm}} = \frac{w_j}{\sum_{k=1}^{M} w_k}$$

De esta forma se garantiza que $\sum_{j=1}^{M} w_{j,\text{norm}} = 1$ (equivalente al $100\%$).

### 2. Puntaje Ponderado Total
Para cada alternativa $i$ calificada con $x_{i,j} \in [1, 10]$ en el criterio $j$, su puntaje total $S_i \in [0.00, 10.00]$ es:

$$S_i = \sum_{j=1}^{M} \left( x_{i,j} \cdot w_{j,\text{norm}} \right)$$

### 3. Análisis de Sensibilidad ($\pm 20\%$)
Se identifica el criterio dominante $d = \arg\max_j (w_j)$ y se evalúan dos perturbaciones sobre su peso bruto manteniendo fijos los pesos brutos $w_j$ ($j \neq d$):
- **Escenario $+20\%$:** $w_d^{(+)} = 1.20 \cdot w_d$, re-normalizando todos los pesos entre $w_d^{(+)} + \sum_{j \neq d} w_j$.
- **Escenario $-20\%$:** $w_d^{(-)} = 0.80 \cdot w_d$, re-normalizando todos los pesos entre $w_d^{(-)} + \sum_{j \neq d} w_j$.

Si la alternativa en primer lugar coincide en ambos escenarios con la ganadora original, la decisión se reporta como **`Estable (la opción ganadora no cambia)`**; en caso contrario, se reporta como **`Sensible (otra alternativa toma el primer lugar)`**.

---

## Instrucciones de Ejecución

1. Guarda los cuatro archivos (`index.html`, `styles.css`, `app.js`, `README.md`) dentro de una misma carpeta local.
2. Haz doble clic sobre `index.html` o ábrelo directamente en cualquier navegador web moderno (Chrome, Firefox, Edge, Safari).
3. No requiere servidor backend, compilación ni conexión a internet.

---

## Pruebas Verificables (Decisión Demo)

Al presionar el botón **"Cargar Decisión Demo"**, se cargan **3 laptops** evaluadas bajo **5 criterios** cuya suma de pesos brutos es $100$:

| Criterio | Peso Bruto | Peso Normalizado | Laptop A (Ultrabook Pro 14) | Laptop B (Workstation X15) | Laptop C (AirBook Lite 13) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Precio** | 25 | 25.0% | 6 (`+1.50`) | 5 (`+1.25`) | 9 (`+2.25`) |
| **Rendimiento** *(Dominante)* | 30 | 30.0% | 8 (`+2.40`) | 10 (`+3.00`) | 6 (`+1.80`) |
| **Batería** | 20 | 20.0% | 9 (`+1.80`) | 6 (`+1.20`) | 8 (`+1.60`) |
| **Portabilidad** | 15 | 15.0% | 9 (`+1.35`) | 5 (`+0.75`) | 10 (`+1.50`) |
| **Pantalla** | 10 | 10.0% | 9 (`+0.90`) | 9 (`+0.90`) | 7 (`+0.70`) |
| **Puntaje Total Esperado** | **100** | **100.0%** | **7.95** *(1.º)* | **7.10** *(3.º)* | **7.85** *(2.º)* |

### Verificación del Análisis de Sensibilidad en la Demo
- **Criterio dominante:** `Rendimiento` (peso bruto `30` / `30.0%`).
- **Escenario $+20\%$ (`Rendimiento` = `36`, suma total = `106`):**
  - **Laptop A:** `7.95` ($843 / 106 \approx 7.9528$) — *1.º lugar*
  - **Laptop C:** `7.75` ($821 / 106 \approx 7.7453$) — *2.º lugar*
  - **Laptop B:** `7.26` ($770 / 106 \approx 7.2642$) — *3.º lugar*
- **Escenario $-20\%$ (`Rendimiento` = `24`, suma total = `94`):**
  - **Laptop C:** `7.97` ($749 / 94 \approx 7.9681$) — *Toma el 1.º lugar*
  - **Laptop A:** `7.95` ($747 / 94 \approx 7.9468$) — *2.º lugar*
  - **Laptop B:** `6.91` ($650 / 94 \approx 6.9149$) — *3.º lugar*
- **Resultado esperado:** **`Sensible (otra alternativa toma el primer lugar)`**.
