"""
This code was extracted in part from
https://github.com/PyCQA/bandit. Using similar heuristic logic,
we adapted it to fit our plugin infrastructure, to create an organized,
concerted effort in detecting all type of secrets in code.
Copyright (c) 2014 Hewlett-Packard Development Company, L.P.
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
"""
import re
from typing import Any
from typing import Dict
from typing import Generator
from typing import Optional
from typing import Pattern
from typing import Set
from ..core.potential\_secret import PotentialSecret
from ..util.filetype import determine\_file\_type
from ..util.filetype import FileType
from .base import BasePlugin
from detect\_secrets.util.code\_snippet import CodeSnippet
# Note: All values here should be lowercase
DENYLIST = (
'api\_?key',
'auth\_?key',
'service\_?key',
'account\_?key',
'db\_?key',
'database\_?key',
'priv\_?key',
'private\_?key',
'client\_?key',
'db\_?pass',
'database\_?pass',
'key\_?pass',
'password',
'passwd',
'pwd',
'secret',
'contraseña',
'contrasena',
)
# Includes ], ', " as closing
CLOSING = r'[]\'"]{0,2}'
AFFIX\_REGEX = r'\w\*'
DENYLIST\_REGEX = r'|'.join(DENYLIST)
# Support for suffix after keyword i.e. password\_secure = "value"
DENYLIST\_REGEX = r'({denylist}){suffix}'.format(
denylist=DENYLIST\_REGEX,
suffix=AFFIX\_REGEX,
)
# Support for prefix and suffix with keyword, needed for reverse comparisons
# i.e. if ("value" == my\_password\_secure) {}
DENYLIST\_REGEX\_WITH\_PREFIX = r'{prefix}{denylist}'.format(
prefix=AFFIX\_REGEX,
denylist=DENYLIST\_REGEX,
)
# Non-greedy match
OPTIONAL\_WHITESPACE = r'\s\*'
OPTIONAL\_NON\_WHITESPACE = r'[^\s]{0,50}?'
QUOTE = r'[\'"`]'
# Secret regex details:
# (?=[^\v\'"]\*) -> this section match with every character except line breaks and quotes. This
# allows to find secrets that starts with symbols or alphanumeric characters.
#
# (?=\w+) -> this section match only with words (letters, numbers or \_ are allowed), and at
# least one character is required. This allows to reduce the false positives
# number.
#
# [^\v\'"]\* -> this section match with every character except line breaks and quotes. This
# allows to find secrets with symbols at the end.
#
# [^\v,\'"`] -> this section match with the last secret character that can be everything except
# line breaks, comma, backticks or quotes. This allows to reduce the false
# positives number and to prevent errors in the code snippet highlighting.
SECRET = r'(?=[^\v\'\"]\*)(?=\w+)[^\v\'\"]\*[^\v,\'\"`]'
SQUARE\_BRACKETS = r'(\[[0-9]\*\])'
FOLLOWED\_BY\_COLON\_EQUAL\_SIGNS\_REGEX = re.compile(
# e.g. my\_password := "bar" or my\_password := bar
r'{denylist}({closing})?{whitespace}:={whitespace}({quote}?)({secret})(\3)'.format(
denylist=DENYLIST\_REGEX,
closing=CLOSING,
quote=QUOTE,
whitespace=OPTIONAL\_WHITESPACE,
secret=SECRET,
),
flags=re.IGNORECASE,
)
FOLLOWED\_BY\_COLON\_REGEX = re.compile(
# e.g. api\_key: foo
r'{denylist}({closing})?:{whitespace}({quote}?)({secret})(\3)'.format(
denylist=DENYLIST\_REGEX,
closing=CLOSING,
quote=QUOTE,
whitespace=OPTIONAL\_WHITESPACE,
secret=SECRET,
),
flags=re.IGNORECASE,
)
FOLLOWED\_BY\_COLON\_QUOTES\_REQUIRED\_REGEX = re.compile(
# e.g. api\_key: "foo"
r'{denylist}({closing})?:({whitespace})({quote})({secret})(\4)'.format(
denylist=DENYLIST\_REGEX,
closing=CLOSING,
quote=QUOTE,
whitespace=OPTIONAL\_WHITESPACE,
secret=SECRET,
),
flags=re.IGNORECASE,
)
FOLLOWED\_BY\_EQUAL\_SIGNS\_OPTIONAL\_BRACKETS\_OPTIONAL\_AT\_SIGN\_QUOTES\_REQUIRED\_REGEX = re.compile(
# e.g. my\_password = "bar"
# e.g. my\_password = @"bar"
# e.g. my\_password[] = "bar";
# e.g. char my\_password[25] = "bar";
r'{denylist}({square\_brackets})?{optional\_whitespace}[!=]{{1,2}}{optional\_whitespace}(@)?(")({secret})(\5)'.format( # noqa: E501
denylist=DENYLIST\_REGEX,
square\_brackets=SQUARE\_BRACKETS,
optional\_whitespace=OPTIONAL\_WHITESPACE,
secret=SECRET,
),
flags=re.IGNORECASE,
)
FOLLOWED\_BY\_OPTIONAL\_ASSIGN\_QUOTES\_REQUIRED\_REGEX = re.compile(
# e.g. std::string secret("bar");
# e.g. secret.assign("bar",17);
r'{denylist}(.assign)?\((")({secret})(\3)'.format(
denylist=DENYLIST\_REGEX,
secret=SECRET,
),
)
FOLLOWED\_BY\_EQUAL\_SIGNS\_REGEX = re.compile(
# e.g. my\_password = bar
# e.g. my\_password == "bar" or my\_password != "bar" or my\_password === "bar"
# or my\_password !== "bar"
# e.g. my\_password == 'bar' or my\_password != 'bar' or my\_password === 'bar'
# or my\_password !== 'bar'
r'{denylist}({closing})?{whitespace}(={{1,3}}|!==?){whitespace}({quote}?)({secret})(\4)'.format( # noqa: E501
denylist=DENYLIST\_REGEX,
closing=CLOSING,
quote=QUOTE,
whitespace=OPTIONAL\_WHITESPACE,
secret=SECRET,
),
flags=re.IGNORECASE,
)
FOLLOWED\_BY\_EQUAL\_SIGNS\_QUOTES\_REQUIRED\_REGEX = re.compile(
# e.g. my\_password = "bar"
# e.g. my\_password == "bar" or my\_password != "bar" or my\_password === "bar"
# or my\_password !== "bar"
# e.g. my\_password == 'bar' or my\_password != 'bar' or my\_password === 'bar'
# or my\_password !== 'bar'
r'{denylist}({closing})?{whitespace}(={{1,3}}|!==?){whitespace}({quote})({secret})(\4)'.format( # noqa: E501
denylist=DENYLIST\_REGEX,
closing=CLOSING,
quote=QUOTE,
whitespace=OPTIONAL\_WHITESPACE,
secret=SECRET,
),
flags=re.IGNORECASE,
)
PRECEDED\_BY\_EQUAL\_COMPARISON\_SIGNS\_QUOTES\_REQUIRED\_REGEX = re.compile(
# e.g. "bar" == my\_password or "bar" != my\_password or "bar" === my\_password
# or "bar" !== my\_password
# e.g. 'bar' == my\_password or 'bar' != my\_password or 'bar' === my\_password
# or 'bar' !== my\_password
r'({quote})({secret})(\1){whitespace}[!=]{{2,3}}{whitespace}{denylist}'.format(
denylist=DENYLIST\_REGEX\_WITH\_PREFIX,
quote=QUOTE,
whitespace=OPTIONAL\_WHITESPACE,
secret=SECRET,
),
)
FOLLOWED\_BY\_QUOTES\_AND\_SEMICOLON\_REGEX = re.compile(
# e.g. private\_key "something";
r'{denylist}{nonWhitespace}{whitespace}({quote})({secret})(\2);'.format(
denylist=DENYLIST\_REGEX,
nonWhitespace=OPTIONAL\_NON\_WHITESPACE,
quote=QUOTE,
whitespace=OPTIONAL\_WHITESPACE,
secret=SECRET,
),
flags=re.IGNORECASE,
)
FOLLOWED\_BY\_ARROW\_FUNCTION\_SIGN\_QUOTES\_REQUIRED\_REGEX = re.compile(
# e.g. my\_password => "bar" or my\_password => bar
r'{denylist}({closing})?{whitespace}=>?{whitespace}({quote})({secret})(\3)'.format(
denylist=DENYLIST\_REGEX,
closing=CLOSING,
quote=QUOTE,
whitespace=OPTIONAL\_WHITESPACE,
secret=SECRET,
),
flags=re.IGNORECASE,
)
CONFIG\_DENYLIST\_REGEX\_TO\_GROUP = {
FOLLOWED\_BY\_COLON\_REGEX: 4,
PRECEDED\_BY\_EQUAL\_COMPARISON\_SIGNS\_QUOTES\_REQUIRED\_REGEX: 2,
FOLLOWED\_BY\_EQUAL\_SIGNS\_REGEX: 5,
FOLLOWED\_BY\_QUOTES\_AND\_SEMICOLON\_REGEX: 3,
}
GOLANG\_DENYLIST\_REGEX\_TO\_GROUP = {
FOLLOWED\_BY\_COLON\_EQUAL\_SIGNS\_REGEX: 4,
PRECEDED\_BY\_EQUAL\_COMPARISON\_SIGNS\_QUOTES\_REQUIRED\_REGEX: 2,
FOLLOWED\_BY\_EQUAL\_SIGNS\_REGEX: 5,
FOLLOWED\_BY\_QUOTES\_AND\_SEMICOLON\_REGEX: 3,
}
COMMON\_C\_DENYLIST\_REGEX\_TO\_GROUP = {
FOLLOWED\_BY\_EQUAL\_SIGNS\_OPTIONAL\_BRACKETS\_OPTIONAL\_AT\_SIGN\_QUOTES\_REQUIRED\_REGEX: 6,
}
C\_PLUS\_PLUS\_REGEX\_TO\_GROUP = {
FOLLOWED\_BY\_OPTIONAL\_ASSIGN\_QUOTES\_REQUIRED\_REGEX: 4,
FOLLOWED\_BY\_EQUAL\_SIGNS\_QUOTES\_REQUIRED\_REGEX: 5,
}
QUOTES\_REQUIRED\_DENYLIST\_REGEX\_TO\_GROUP = {
FOLLOWED\_BY\_COLON\_QUOTES\_REQUIRED\_REGEX: 5,
PRECEDED\_BY\_EQUAL\_COMPARISON\_SIGNS\_QUOTES\_REQUIRED\_REGEX: 2,
FOLLOWED\_BY\_EQUAL\_SIGNS\_QUOTES\_REQUIRED\_REGEX: 5,
FOLLOWED\_BY\_QUOTES\_AND\_SEMICOLON\_REGEX: 3,
FOLLOWED\_BY\_ARROW\_FUNCTION\_SIGN\_QUOTES\_REQUIRED\_REGEX: 4,
}
REGEX\_BY\_FILETYPE = {
FileType.GO: GOLANG\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.OBJECTIVE\_C: COMMON\_C\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.C\_SHARP: COMMON\_C\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.C: COMMON\_C\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.C\_PLUS\_PLUS: C\_PLUS\_PLUS\_REGEX\_TO\_GROUP,
FileType.CLS: QUOTES\_REQUIRED\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.JAVA: QUOTES\_REQUIRED\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.JAVASCRIPT: QUOTES\_REQUIRED\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.PYTHON: QUOTES\_REQUIRED\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.SWIFT: QUOTES\_REQUIRED\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.TERRAFORM: QUOTES\_REQUIRED\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.YAML: CONFIG\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.CONFIG: CONFIG\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.INI: CONFIG\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.PROPERTIES: CONFIG\_DENYLIST\_REGEX\_TO\_GROUP,
FileType.TOML: CONFIG\_DENYLIST\_REGEX\_TO\_GROUP,
}
class KeywordDetector(BasePlugin):
"""
Scans for secret-sounding variable names.
This checks if denylisted keywords are present in the analyzed string.
"""
secret\_type = 'Secret Keyword'
def \_\_init\_\_(self, keyword\_exclude: Optional[str] = None) -> None:
self.keyword\_exclude = None
if keyword\_exclude:
self.keyword\_exclude = re.compile(
keyword\_exclude,
re.IGNORECASE,
)
def analyze\_string(
self,
string: str,
denylist\_regex\_to\_group: Optional[Dict[Pattern, int]] = None,
) -> Generator[str, None, None]:
if self.keyword\_exclude and self.keyword\_exclude.search(string):
return
if denylist\_regex\_to\_group is None:
attempts = [
QUOTES\_REQUIRED\_DENYLIST\_REGEX\_TO\_GROUP,
]
else:
attempts = [denylist\_regex\_to\_group]
has\_results = False
for denylist\_regex\_to\_group in attempts:
for denylist\_regex, group\_number in denylist\_regex\_to\_group.items():
match = denylist\_regex.search(string)
if match:
has\_results = True
yield match.group(group\_number)
if has\_results:
break
def analyze\_line(
self,
filename: str,
line: str,
line\_number: int = 0,
context: CodeSnippet = None,
\*\*kwargs: Any,
) -> Set[PotentialSecret]:
filetype = determine\_file\_type(filename)
denylist\_regex\_to\_group = REGEX\_BY\_FILETYPE.get(filetype, QUOTES\_REQUIRED\_DENYLIST\_REGEX\_TO\_GROUP) # noqa: E501
return super().analyze\_line(
filename=filename,
line=line,
line\_number=line\_number,
context=context,
denylist\_regex\_to\_group=denylist\_regex\_to\_group,
)
def json(self) -> Dict[str, Any]:
return {
'keyword\_exclude': (
self.keyword\_exclude.pattern
if self.keyword\_exclude
else ''
),
\*\*super().json(),
}
