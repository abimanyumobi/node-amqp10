var btools      = require('buffertools'),
    cbuf        = require('cbarrick-circular-buffer'),
    debug       = require('debug')('amqp10-MockServer'),
    net         = require('net'),
    StateMachine= require('stately.js'),
    should      = require('should'),

    constants   = require('../lib/constants');

var MockServer = function(port) {
    this.server = null;
    this.conn = null;
    this.port = port || 4321;
    this.data = new cbuf({ size: 1024, encoding: 'buffer' });
    this.requestsExpected = [];
    this.responsesToSend = [];
    this.serverGoesFirst = false;
    this.listenAttempts = 0;
    this.client = null;
};

MockServer.prototype._listen = function() {
    var self = this;
    self.listenAttempts++;
    self.server.listen(this.port, function() {
        debug('Server listening on '+self.port);
    });
};

MockServer.prototype.setup = function(client) {
    if (this.server) {
        this.teardown();
    }

    this.client = client;

    var self = this;
    var connectionHandler = function (c) {
        debug('Connection established');
        self.conn = c;
        if (self.serverGoesFirst) {
            self._sendNext();
        }
        c.on('end', function() { debug('Connection terminated'); });
        c.on('data', function(d) { self.data.write(d); self._testData(); });
    };
    self.server = net.createServer(connectionHandler);
    self.server.on('error', function(err) {
        if (err.code == 'EADDRINUSE') {
            self.listenAttempts.should.be.lessThan(5, 'Failed to connect too many times');
            debug('Address in use on '+self.port+', trying again...');
            self.port++;
            self.server = self._listen();
        } else {
            should.fail('Error starting mock server: ' + err);
        }
    });
    self._listen();
};

MockServer.prototype.teardown = function() {
    if (this.server) {
        this.server.close(function() { debug('Server shutting down'); });
        this.server = null;
    }
};

MockServer.prototype.setSequence = function(reqs, resps, serverFirst) {
    this.requestsExpected = reqs;
    this.responsesToSend = resps;
    this.serverGoesFirst = serverFirst;
};

MockServer.prototype._sendNext = function() {
    var toSend = this.responsesToSend.shift();
    if (toSend && typeof toSend === 'string') {
        switch (toSend) {
            case 'disconnect':
                this.conn.end();
                break;
            case 'error':
                this.client.client.emit('error', 'Forced error');
                break;
            default:
                this.conn.write(toSend, 'utf8', function() { debug('Wrote ' + toSend); });
        }
    } else if (toSend) {
        this.conn.write(toSend);
    } else {
        debug('No data to send.');
    }
};

MockServer.prototype._testData = function() {
    this.requestsExpected.length.should.be.greaterThan(0, 'More data received than expected');
    var expected = this.requestsExpected[0];
    if (this.data.length >= expected.length) {
        expected = this.requestsExpected.shift();
        var actual = this.data.read(expected.length);
        actual.toString('hex').should.eql(expected.toString('hex'));
        this._sendNext();
    }
};

MockServer.prototype.assertSequence = function(doneCB, timeout) {
    var timeoutInMillis = timeout || 1000;
    setTimeout(function() {
        doneCB();
    }, timeoutInMillis);
};

module.exports = MockServer;
