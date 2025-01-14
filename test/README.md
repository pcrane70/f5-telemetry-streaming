# Introduction

This directory contains all of the tests for this project.  This documentation is designed to make clear things that would otherwise be unclear.

## Logging

- keep output to console clean as much as possible. Use `console` to log information about tests only (e.g. test skip). Of course you can still use `console` during development process.
- use `logger` from `winstonLogger.js` to log all information from tests which can be useful for debugging. All logs (from `console` too) will be written to `test/artifacts/testoutput.log`

## Unit

All unit tests are written using the [mocha](https://mochajs.org) framework, and run using ```npm run test``` during automated or manual test.

Triggered: Every commit pushed to central repository.

Best practices:

- Create a separate ```*Test.js``` for each source file being tested.
- Keep mocking simple:  Simply overwrite the dependent module's function(s) after a require where possible, which is most of the time. Note: Mocha consolidates requires between test files, place require inside the ```before``` function (or similar) to avoid this behavior.
- Keep the folder structure flat, this project is not that large or complex.
- Monitor and enforce coverage, but avoid writing tests simply to increase coverage when there is no other perceived value.
- With that being said, **enforce coverage** in automated test.

## Functional

All functional tests reside inside the ```functional``` folder and are run using ```npm run test-functional```.

Triggered: Recurring schedule, nightly - This could be extended in the future to commits pushed to stable branches such as develop.

Best Practices:

- Clean up after yourself - although it is a fairly safe assumption to make that this is a fresh environment consider if it were multi-use when writing tests
- Consider carefully before testing things in functional test that should or could be tested via unit test - those are run more frequently
- All consumer related tests should be added to `test/functional/consumersTests` directory.
- All TS package related tests should be added to `test/function/dutTests.js`

### Types

#### DUT

We verify TS package (installation and removal) and sending configurations for system pollers and event listeners. The declaration can be found at `test/function/shared/basic.json`.

#### Consumers

Testing against each consumer is important to ensure changes in the project that break a given consumer are caught and fixed.  Use the following flow as a guideline for this validation.

- Setup the consumer (container preferred)
  - Start container/service
  - Create listener (as needed, e.g. Splunk http data collector)
- Send TS a declaration containing consumer
- Query consumer for system poller data (once interval has passed)
- Trigger event listener event in TS
- Query consumer for event listener data
- Tear down the consumer

### Environment

#### CI/CD Pipeline

It is somewhat implied that running the functional tests requires a runtime (BIG-IP, container, etc.) to deploy the iLX extension, consumers, etc.  The current methodology is to deploy and re-use the runtime every time functional tests are run, with the understanding that functional tests will be run less frequently than unit tests.

The deploy/teardown environment steps are handled using an internal tool (cicd-bigip-deploy) initially created for an unrelated project by one of the developers of this project, see the **deploy_env** job in the ```.gitlab-ci.yml``` file for additional comments.  Essentially the flow looks like the following in the pipeline:

1. Pipeline triggered - with `REQ_DEVICE_PIPELINE` and `RUN_FUNCTIONAL_TESTS` set to true
2. **deploy_env** step will run, ***only*** if the variable `REQ_DEVICE_PIPELINE` is set to true
2.1 `CICD_PROJECT_NAME` - specify project's name to deploy harness with unique name otherwise default name will be used. Do not forget to run **teardown_env** at the end of development process manually!
3. The **functional test** step will run, ***only*** if the variable `RUN_FUNCTIONAL_TESTS` is set to true

Internal tool notes:

- It is packaged as a container made available via an internal docker repository, a project variable contains the url for the container.
- It uses VIO as the runtime for instance creation/deletion, project variables contain the name of the VIO project, VIO credentials, etc.

#### Local

##### Creating a new build

Simply run `npm run build` to create a new rpm. A new package and sha256 file are created in `dist/new_build`.

For mac users, you may need to follow the additional steps before you run the build if you're missing `sha256sum` on your machine.

1. Install coreutils by running `brew install coreutils`. If you are missing brew, follow the [instructions on the homebrew website](https://brew.sh)

2. Add the following to your `~/.bashrc` file: `export PATH="$PATH:/usr/local/opt/coreutils/libexec/gnubin"`

3. Run `source ~/.bashrc`.

##### Running tests

If you already have an existing set of devices, you can run the functional tests manually by following the steps below:

1. Create a `harness_facts_flat.json` file to specify the resources. A minimum of one BIG-IP (13.+) and one Ubuntu server (18.+) (for consumer tests) is needed.

        Sample harness_facts_flat.json
        [
            {
                "admin_ip": "192.168.1.3",
                "f5_rest_user": {
                    "username": "admin",
                    "password": "admin"
                },
                "f5_hostname": "ts_test_13_1-bigip.localhost.localdomain",
                "type": "bigip",
                "is_f5_device": true
            },
            {
                "admin_ip": "192.168.1.4",
                "ssh_user": {
                    "username": "root",
                    "password": "default"
                }
            }
        ]


2. Set your environment variables. Note that the DUT tests will still run setup. It grabs the rpm if it exists in `dist/new_build`, otherwise, it will check the main `dist/` for rpms, picking one with the latest timestamp.

        Env variables

        SKIP_DUT_TESTS - set value to 1 or true to skip package tests against BIG-IP. DUT device setup/teardown will still run.
        SKIP_CONSUMER_TESTS - set value to 1 or true to skip package tests against Consumers
        CONSUMER_TYPE_REGEX - specify RegEx to filter Consumers by name

3. Trigger the test run with `npm run test-functional`.

    
##### Sample bash script to run functional tests

        
        #!/usr/bin/env bash
        export SKIP_DUT_TESTS="true"
        export SKIP_CONSUMER_TESTS="false"
        export CONSUMER_TYPE_REGEX="splunk"
        export TEST_HARNESS_FILE="/path/to/harness_facts_flat.json"
        npm run test-functional
        
