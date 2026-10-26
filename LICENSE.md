# Licence

Copyright 2026 the levtrap contributors.

**levtrap** is a derivative work of the Optical Tweezers Toolbox (OTT)
version 1, ported from MATLAB to Python.  It is released under the same
licence as OTT v1:

**Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**
<https://creativecommons.org/licenses/by-nc/4.0/>
(full legal code: <https://creativecommons.org/licenses/by-nc/4.0/legalcode>)

You may share and adapt this work for **non-commercial purposes only**,
provided you give appropriate credit, link to the licence and indicate if
changes were made.

## Original work — notice retained from OTT v1

> Copyright 2007-2018 The University of Queensland.
>
> This package and its component files are copyright 2007-2018 by
> The University of Queensland.  Except where otherwise noted, this
> version is released under the Creative Commons
> Attribution-NonCommercial 4.0 International License.
>
> To view a copy of this license, visit
> http://creativecommons.org/licenses/by-nc/4.0/.

OTT source: <https://github.com/ilent2/ott> (v1.5.x, commit
`e6736643e5f3664783d4301e901c47e81ae62728`).

## How to cite

If you use this software, please cite the OTT paper:

T. A. Nieminen, V. L. Y. Loke, A. B. Stilgoe, G. Knöner, A. M. Brańczyk,
N. R. Heckenberg and H. Rubinsztein-Dunlop, "Optical tweezers computational
toolbox", *J. Opt. A: Pure Appl. Opt.* **9**, S196–S203 (2007).

## Changes relative to OTT

The physics routines listed in `PLAN.md` (progress log) were translated to
Python/NumPy; behaviour follows OTT except where noted with `# OTT:`
comments in the source and in the progress log.

## Third-party components

* NumPy (BSD-3-Clause) and SciPy (BSD-3-Clause), used unmodified.
* The web interface loads Pyodide (MPL-2.0) and Plotly.js (MIT) from a CDN.
