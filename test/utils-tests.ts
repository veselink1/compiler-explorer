// Copyright (c) 2017, Compiler Explorer Authors
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

import path from 'path';
import {fileURLToPath} from 'url';

import winston from 'winston';

import {logger, makeLogStream} from '../lib/logger';
import * as utils from '../lib/utils';

import {fs} from './utils';

describe('Splits lines', () => {
    it('handles empty input', () => {
        utils.splitLines('').should.deep.equals([]);
    });
    it('handles a single line with no newline', () => {
        utils.splitLines('A line').should.deep.equals(['A line']);
    });
    it('handles a single line with a newline', () => {
        utils.splitLines('A line\n').should.deep.equals(['A line']);
    });
    it('handles multiple lines', () => {
        utils.splitLines('A line\nAnother line\n').should.deep.equals(['A line', 'Another line']);
    });
    it('handles multiple lines ending on a non-newline', () => {
        utils.splitLines('A line\nAnother line\nLast line').should.deep.equals(['A line', 'Another line', 'Last line']);
    });
    it('handles empty lines', () => {
        utils.splitLines('A line\n\nA line after an empty').should.deep.equals(['A line', '', 'A line after an empty']);
    });
    it('handles a single empty line', () => {
        utils.splitLines('\n').should.deep.equals(['']);
    });
    it('handles multiple empty lines', () => {
        utils.splitLines('\n\n\n').should.deep.equals(['', '', '']);
    });
    it('handles \\r\\n lines', () => {
        utils.splitLines('Some\r\nLines\r\n').should.deep.equals(['Some', 'Lines']);
    });
});

describe('Expands tabs', () => {
    it('leaves non-tabs alone', () => {
        utils.expandTabs('This has no tabs at all').should.equals('This has no tabs at all');
    });
    it('at beginning of line', () => {
        utils.expandTabs('\tOne tab').should.equals('        One tab');
        utils.expandTabs('\t\tTwo tabs').should.equals('                Two tabs');
    });
    it('mid-line', () => {
        utils.expandTabs('0\t1234567A').should.equals('0       1234567A');
        utils.expandTabs('01\t234567A').should.equals('01      234567A');
        utils.expandTabs('012\t34567A').should.equals('012     34567A');
        utils.expandTabs('0123\t4567A').should.equals('0123    4567A');
        utils.expandTabs('01234\t567A').should.equals('01234   567A');
        utils.expandTabs('012345\t67A').should.equals('012345  67A');
        utils.expandTabs('0123456\t7A').should.equals('0123456 7A');
        utils.expandTabs('01234567\tA').should.equals('01234567        A');
    });
});

describe('Parses compiler output', () => {
    it('handles simple cases', () => {
        utils.parseOutput('Line one\nLine two', 'bob.cpp').should.deep.equals([{text: 'Line one'}, {text: 'Line two'}]);
        utils.parseOutput('Line one\nbob.cpp:1 Line two', 'bob.cpp').should.deep.equals([
            {text: 'Line one'},
            {
                tag: {column: 0, line: 1, text: 'Line two', severity: 3, file: 'bob.cpp'},
                text: '<source>:1 Line two',
            },
        ]);
        utils.parseOutput('Line one\nbob.cpp:1:5: Line two', 'bob.cpp').should.deep.equals([
            {text: 'Line one'},
            {
                tag: {column: 5, line: 1, text: 'Line two', severity: 3, file: 'bob.cpp'},
                text: '<source>:1:5: Line two',
            },
        ]);
    });
    it('handles windows output', () => {
        utils.parseOutput('bob.cpp(1) Oh noes', 'bob.cpp').should.deep.equals([
            {
                tag: {column: 0, line: 1, text: 'Oh noes', severity: 3, file: 'bob.cpp'},
                text: '<source>(1) Oh noes',
            },
        ]);
    });
    it('replaces all references to input source', () => {
        utils.parseOutput('bob.cpp:1 error in bob.cpp', 'bob.cpp').should.deep.equals([
            {
                tag: {column: 0, line: 1, text: 'error in <source>', severity: 3, file: 'bob.cpp'},
                text: '<source>:1 error in <source>',
            },
        ]);
    });
    it('treats warnings and notes as the correct severity', () => {
        utils.parseOutput('Line one\nbob.cpp:1:5: warning Line two', 'bob.cpp').should.deep.equals([
            {text: 'Line one'},
            {
                tag: {column: 5, line: 1, text: 'warning Line two', severity: 2, file: 'bob.cpp'},
                text: '<source>:1:5: warning Line two',
            },
        ]);
        utils.parseOutput('Line one\nbob.cpp:1:5: note Line two', 'bob.cpp').should.deep.equals([
            {text: 'Line one'},
            {
                tag: {column: 5, line: 1, text: 'note Line two', severity: 1, file: 'bob.cpp'},
                text: '<source>:1:5: note Line two',
            },
        ]);
    });
    it('treats <stdin> as if it were the compiler source', () => {
        utils
            .parseOutput("<stdin>:120:25: error: variable or field 'transform_data' declared void", 'bob.cpp')
            .should.deep.equals([
                {
                    tag: {
                        column: 25,
                        line: 120,
                        text: "error: variable or field 'transform_data' declared void",
                        severity: 3,
                        file: 'bob.cpp',
                    },
                    text: "<source>:120:25: error: variable or field 'transform_data' declared void",
                },
            ]);
    });

    it('parser error with full path', () => {
        utils.parseOutput("/app/example.cl:5:30: error: use of undeclared identifier 'ad'").should.deep.equals([
            {
                tag: {
                    file: 'example.cl',
                    column: 30,
                    line: 5,
                    text: "error: use of undeclared identifier 'ad'",
                    severity: 3,
                },
                text: "example.cl:5:30: error: use of undeclared identifier 'ad'",
            },
        ]);
    });
});

describe('Pascal compiler output', () => {
    it('recognize fpc identifier not found error', () => {
        utils.parseOutput('output.pas(13,23) Error: Identifier not found "adsadasd"', 'output.pas').should.deep.equals([
            {
                tag: {
                    column: 23,
                    line: 13,
                    text: 'Error: Identifier not found "adsadasd"',
                    severity: 3,
                    file: 'output.pas',
                },
                text: '<source>(13,23) Error: Identifier not found "adsadasd"',
            },
        ]);
    });

    it('recognize fpc exiting error', () => {
        utils
            .parseOutput('output.pas(17) Fatal: There were 1 errors compiling module, stopping', 'output.pas')
            .should.deep.equals([
                {
                    tag: {
                        column: 0,
                        line: 17,
                        text: 'Fatal: There were 1 errors compiling module, stopping',
                        severity: 3,
                        file: 'output.pas',
                    },
                    text: '<source>(17) Fatal: There were 1 errors compiling module, stopping',
                },
            ]);
    });

    it('removes the temp path', () => {
        utils
            .parseOutput(
                'Compiling /tmp/path/prog.dpr\noutput.pas(17) Fatal: There were 1 errors compiling module, stopping',
                'output.pas',
                '/tmp/path/',
            )
            .should.deep.equals([
                {
                    text: 'Compiling prog.dpr',
                },
                {
                    tag: {
                        column: 0,
                        line: 17,
                        text: 'Fatal: There were 1 errors compiling module, stopping',
                        severity: 3,
                        file: 'output.pas',
                    },
                    text: '<source>(17) Fatal: There were 1 errors compiling module, stopping',
                },
            ]);
    });
});

describe('Rust compiler output', () => {
    it('handles simple cases', () => {
        utils
            .parseRustOutput('Line one\nLine two', 'bob.rs')
            .should.deep.equals([{text: 'Line one'}, {text: 'Line two'}]);
        utils.parseRustOutput('Unrelated\nLine one\n --> bob.rs:1\nUnrelated', 'bob.rs').should.deep.equals([
            {text: 'Unrelated'},
            {
                tag: {column: 0, line: 1, text: 'Line one', severity: 3},
                text: 'Line one',
            },
            {
                tag: {column: 0, line: 1, text: '', severity: 3},
                text: ' --> <source>:1',
            },
            {text: 'Unrelated'},
        ]);
        utils.parseRustOutput('Line one\n --> bob.rs:1:5', 'bob.rs').should.deep.equals([
            {
                tag: {column: 5, line: 1, text: 'Line one', severity: 3},
                text: 'Line one',
            },
            {
                tag: {column: 5, line: 1, text: '', severity: 3},
                text: ' --> <source>:1:5',
            },
        ]);
    });

    it('replaces all references to input source', () => {
        utils.parseRustOutput('error: Error in bob.rs\n --> bob.rs:1', 'bob.rs').should.deep.equals([
            {
                tag: {column: 0, line: 1, text: 'error: Error in <source>', severity: 3},
                text: 'error: Error in <source>',
            },
            {
                tag: {column: 0, line: 1, text: '', severity: 3},
                text: ' --> <source>:1',
            },
        ]);
    });

    it('treats <stdin> as if it were the compiler source', () => {
        utils.parseRustOutput('error: <stdin> is sad\n --> <stdin>:120:25', 'bob.rs').should.deep.equals([
            {
                tag: {column: 25, line: 120, text: 'error: <source> is sad', severity: 3},
                text: 'error: <source> is sad',
            },
            {
                tag: {column: 25, line: 120, text: '', severity: 3},
                text: ' --> <source>:120:25',
            },
        ]);
    });
});

describe('Tool output', () => {
    it('removes the relative path', () => {
        utils
            .parseOutput('./example.cpp:1:1: Fatal: There were 1 errors compiling module, stopping', './example.cpp')
            .should.deep.equals([
                {
                    tag: {
                        column: 1,
                        line: 1,
                        text: 'Fatal: There were 1 errors compiling module, stopping',
                        severity: 3,
                        file: 'example.cpp',
                    },
                    text: '<source>:1:1: Fatal: There were 1 errors compiling module, stopping',
                },
            ]);
    });

    it('removes fortran relative path', () => {
        utils
            .parseOutput("./example.f90:5:22: error: No explicit type declared for 'y'", './example.f90')
            .should.deep.equals([
                {
                    tag: {
                        column: 22,
                        line: 5,
                        text: "error: No explicit type declared for 'y'",
                        severity: 3,
                        file: 'example.f90',
                    },
                    text: "<source>:5:22: error: No explicit type declared for 'y'",
                },
            ]);
    });

    it('removes the jailed path', () => {
        utils
            .parseOutput(
                '/home/ubuntu/example.cpp:1:1: Fatal: There were 1 errors compiling module, stopping',
                './example.cpp',
            )
            .should.deep.equals([
                {
                    tag: {
                        column: 1,
                        line: 1,
                        text: 'Fatal: There were 1 errors compiling module, stopping',
                        severity: 3,
                        file: 'example.cpp',
                    },
                    text: '<source>:1:1: Fatal: There were 1 errors compiling module, stopping',
                },
            ]);
    });
});

describe('Pads right', () => {
    it('works', () => {
        utils.padRight('abcd', 8).should.equal('abcd    ');
        utils.padRight('a', 8).should.equal('a       ');
        utils.padRight('', 8).should.equal('        ');
        utils.padRight('abcd', 4).should.equal('abcd');
        utils.padRight('abcd', 2).should.equal('abcd');
    });
});

describe('Trim right', () => {
    it('works', () => {
        utils.trimRight('  ').should.equal('');
        utils.trimRight('').should.equal('');
        utils.trimRight(' ab ').should.equal(' ab');
        utils.trimRight(' a  b ').should.equal(' a  b');
        utils.trimRight('a    ').should.equal('a');
    });
});

describe('Anonymizes all kind of IPs', () => {
    it('Ignores localhost', () => {
        utils.anonymizeIp('localhost').should.equal('localhost');
        utils.anonymizeIp('localhost:42').should.equal('localhost:42');
    });
    it('Removes last octet from IPv4 addresses', () => {
        utils.anonymizeIp('127.0.0.0').should.equal('127.0.0.0');
        utils.anonymizeIp('127.0.0.10').should.equal('127.0.0.0');
        utils.anonymizeIp('127.0.0.255').should.equal('127.0.0.0');
    });
    it('Removes last 3 hextets from IPv6 addresses', () => {
        // Not necessarily valid addresses, we're interested in the format
        utils.anonymizeIp('ffff:aaaa:dead:beef').should.equal('ffff:0:0:0');
        utils.anonymizeIp('bad:c0de::').should.equal('bad:0:0:0');
        utils.anonymizeIp(':1d7e::c0fe').should.equal(':0:0:0');
    });
});

describe('Logger functionality', () => {
    it('correctly logs streams split over lines', () => {
        const logs: {level: string; msg: string}[] = [];
        const fakeLog = {log: (level: string, msg: string) => logs.push({level, msg})} as any as winston.Logger;
        const infoStream = makeLogStream('info', fakeLog);
        infoStream.write('first\n');
        infoStream.write('part');
        infoStream.write('ial\n');
        logs.should.deep.equal([
            {
                level: 'info',
                msg: 'first',
            },
            {
                level: 'info',
                msg: 'partial',
            },
        ]);
    });
    it('correctly logs streams to the right destination', () => {
        const logs: {level: string; msg: string}[] = [];
        const fakeLog = {log: (level: string, msg: string) => logs.push({level, msg})} as any as winston.Logger;
        const infoStream = makeLogStream('warn', fakeLog);
        infoStream.write('ooh\n');
        logs.should.deep.equal([
            {
                level: 'warn',
                msg: 'ooh',
            },
        ]);
    });
});

describe('Hash interface', () => {
    it('correctly hashes strings', () => {
        const version = 'Compiler Explorer Tests Version 0';
        utils
            .getHash('cream cheese', version)
            .should.equal('cfff2d1f7a213e314a67cce8399160ae884f794a3ee9d4a01cd37a8c22c67d94');
        utils
            .getHash('large eggs', version)
            .should.equal('9144dec50b8df5bc5cc24ba008823cafd6616faf2f268af84daf49ac1d24feb0');
        utils
            .getHash('sugar', version)
            .should.equal('afa3c89d0f6a61de6805314c9bd7c52d020425a3a3c7bbdfa7c0daec594e5ef1');
    });
    it('correctly hashes objects', () => {
        utils
            .getHash({
                toppings: [
                    {name: 'raspberries', optional: false},
                    {name: 'ground cinnamon', optional: true},
                ],
            })
            .should.equal('e205d63abd5db363086621fdc62c4c23a51b733bac5855985a8b56642d570491');
    });
});

describe('GoldenLayout utils', () => {
    it('finds every editor & compiler', async () => {
        const state = await fs.readJson('test/example-states/default-state.json');
        const contents = utils.glGetMainContents(state.content);
        contents.should.deep.equal({
            editors: [
                {source: 'Editor 1', language: 'c++'},
                {source: 'Editor 2', language: 'c++'},
                {source: 'Editor 3', language: 'c++'},
                {source: 'Editor 4', language: 'c++'},
            ],
            compilers: [
                {compiler: 'clang_trunk'},
                {compiler: 'gsnapshot'},
                {compiler: 'clang_trunk'},
                {compiler: 'gsnapshot'},
                {compiler: 'rv32-clang'},
            ],
        });
    });
});

describe('squashes horizontal whitespace', () => {
    it('handles empty input', () => {
        utils.squashHorizontalWhitespace('').should.equals('');
        utils.squashHorizontalWhitespace(' ').should.equals('');
        utils.squashHorizontalWhitespace('    ').should.equals('');
    });
    it('handles leading spaces', () => {
        utils.squashHorizontalWhitespace(' abc').should.equals(' abc');
        utils.squashHorizontalWhitespace('   abc').should.equals('  abc');
        utils.squashHorizontalWhitespace('       abc').should.equals('  abc');
    });
    it('handles interline spaces', () => {
        utils.squashHorizontalWhitespace('abc abc').should.equals('abc abc');
        utils.squashHorizontalWhitespace('abc   abc').should.equals('abc abc');
        utils.squashHorizontalWhitespace('abc     abc').should.equals('abc abc');
    });
    it('handles leading and interline spaces', () => {
        utils.squashHorizontalWhitespace(' abc  abc').should.equals(' abc abc');
        utils.squashHorizontalWhitespace('  abc abc').should.equals('  abc abc');
        utils.squashHorizontalWhitespace('  abc     abc').should.equals('  abc abc');
        utils.squashHorizontalWhitespace('    abc   abc').should.equals('  abc abc');
    });
});

describe('replaces all substrings', () => {
    it('works with no substitutions', () => {
        const string = 'This is a line with no replacements';
        utils.replaceAll(string, 'not present', "won't be substituted").should.equal(string);
    });
    it('handles odd cases', () => {
        utils.replaceAll('', '', '').should.equal('');
        utils.replaceAll('Hello', '', '').should.equal('Hello');
    });
    it('works with single replacement', () => {
        utils
            .replaceAll('This is a line with a mistook in it', 'mistook', 'mistake')
            .should.equal('This is a line with a mistake in it');
        utils
            .replaceAll('This is a line with a mistook', 'mistook', 'mistake')
            .should.equal('This is a line with a mistake');
        utils.replaceAll('Mistooks were made', 'Mistooks', 'Mistakes').should.equal('Mistakes were made');
    });

    it('works with multiple replacements', () => {
        utils.replaceAll('A mistook is a mistook', 'mistook', 'mistake').should.equal('A mistake is a mistake');
        utils.replaceAll('aaaaaaaaaaaaaaaaaaaaaaaaaaa', 'a', 'b').should.equal('bbbbbbbbbbbbbbbbbbbbbbbbbbb');
    });

    it('works with overlapping replacements', () => {
        utils.replaceAll('aaaaaaaa', 'a', 'ba').should.equal('babababababababa');
    });
});

describe('encodes in our version of base32', () => {
    function doTest(original, expected) {
        utils.base32Encode(Buffer.from(original)).should.equal(expected);
    }

    // Done by hand to check that they are valid

    it('works for empty strings', () => {
        doTest('', '');
    });

    it('works for lengths multiple of 5 bits', () => {
        doTest('aaaaa', '3Mn4ha7P');
    });

    it('works for lengths not multiple of 5 bits', () => {
        // 3
        doTest('a', '35');

        // 1
        doTest('aa', '3Mn1');

        // 4
        doTest('aaa', '3Mn48');

        // 2
        doTest('aaaa', '3Mn4ha3');
    });

    it('works for some random strings', () => {
        // I also calculated this ones so lets put them
        doTest('foo', '8rrx8');

        doTest('foobar', '8rrx8b7Pc5');
    });
});

describe('fileExists', () => {
    it('Returns true for files that exists', async () => {
        (await utils.fileExists(fileURLToPath(import.meta.url))).should.be.true;
    });
    it("Returns false for files that don't exist", async () => {
        (await utils.fileExists('./ABC-FileThatDoesNotExist.extension')).should.be.false;
    });
    it('Returns false for directories that exist', async () => {
        (await utils.fileExists(path.resolve(path.dirname(fileURLToPath(import.meta.url))))).should.be.false;
    });
});

describe('safe semver', () => {
    it('should understand most kinds of semvers', () => {
        utils.asSafeVer('0').should.equal('0.0.0');
        utils.asSafeVer('1').should.equal('1.0.0');

        utils.asSafeVer('1.0').should.equal('1.0.0');
        utils.asSafeVer('1.1').should.equal('1.1.0');

        utils.asSafeVer('1.1.0').should.equal('1.1.0');
        utils.asSafeVer('1.1.1').should.equal('1.1.1');

        const MAGIC_TRUNK_VERSION = '9999999.99999.999';
        utils.asSafeVer('trunk').should.equal(MAGIC_TRUNK_VERSION);
        utils.asSafeVer('(trunk)').should.equal(MAGIC_TRUNK_VERSION);
        utils.asSafeVer('(123.456.789 test)').should.equal(MAGIC_TRUNK_VERSION);

        utils.asSafeVer('0..0').should.equal(MAGIC_TRUNK_VERSION);
        utils.asSafeVer('0.0.').should.equal(MAGIC_TRUNK_VERSION);
        utils.asSafeVer('0.').should.equal(MAGIC_TRUNK_VERSION);
        utils.asSafeVer('.0.0').should.equal(MAGIC_TRUNK_VERSION);
        utils.asSafeVer('.0..').should.equal(MAGIC_TRUNK_VERSION);
        utils.asSafeVer('0..').should.equal(MAGIC_TRUNK_VERSION);

        utils.asSafeVer('123 TEXT').should.equal('123.0.0');
        utils.asSafeVer('123.456 TEXT').should.equal('123.456.0');
        utils.asSafeVer('123.456.789 TEXT').should.equal('123.456.789');
    });
});

describe('argument splitting', () => {
    it('should handle normal things', () => {
        utils
            .splitArguments('-hello --world etc --std=c++20')
            .should.deep.equal(['-hello', '--world', 'etc', '--std=c++20']);
    });

    it('should handle hash chars', () => {
        utils
            .splitArguments('-Wno#warnings -Wno-#pragma-messages')
            .should.deep.equal(['-Wno#warnings', '-Wno-#pragma-messages']);
    });

    it('should handle doublequoted args', () => {
        utils.splitArguments('--hello "-world etc"').should.deep.equal(['--hello', '-world etc']);
    });

    it('should handle singlequoted args', () => {
        utils.splitArguments("--hello '-world etc'").should.deep.equal(['--hello', '-world etc']);
    });

    it('should handle cheekyness part 1', () => {
        /* eslint-disable no-useless-escape */
        utils.splitArguments('hello #veryfancy etc').should.deep.equal(['hello', '#veryfancy', 'etc']);
        /* eslint-enable no-useless-escape */
    });

    it('should handle cheekyness part 2', () => {
        utils.splitArguments('hello \\#veryfancy etc').should.deep.equal(['hello', '\\']);
    });
});
