# Third-party notices

`src/utils/entities-data.ts` contains named character reference data from the WHATWG HTML Living Standard.
Source: https://html.spec.whatwg.org/entities.json (retrieved September 8, 2026).
The generated lookup retains only semicolon-terminated names and their Unicode character values.

The WHATWG IPR policy licenses portions incorporated into source code under the BSD 3-Clause License:
https://whatwg.org/ipr-policy#copyright

Copyright © WHATWG (Apple, Google, Mozilla, Microsoft).

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
OF THE POSSIBILITY OF SUCH DAMAGE.

## GitHub Flavored Markdown specification examples

`test/fixtures/gfm-official.json` contains the 28 normative extension examples from the GFM 0.29-gfm specification.
GitHub maintains the specification, which extends CommonMark by John MacFarlane and contributors.
Source: https://github.github.com/gfm/ (retrieved September 8, 2026).
License: Creative Commons Attribution-ShareAlike 4.0 International (CC-BY-SA-4.0).
License terms: https://creativecommons.org/licenses/by-sa/4.0/legalcode

The JSON extraction decodes HTML serialization and expands visible tab markers.
The fixture file remains under CC-BY-SA-4.0. These fixtures are excluded from the published package.
Neo parser code remains under its existing MIT license. No endorsement by the specification authors is implied.
