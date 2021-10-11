import {
  RocketDAONodeTrusted, RocketDAONodeTrustedSettingsMinipool,
  RocketDAOProtocolSettingsMinipool,
  RocketDAOProtocolSettingsNetwork,
  RocketMinipool
} from '../_utils/artifacts';
import { increaseTime, mineBlocks } from '../_utils/evm';
import { printTitle } from '../_utils/formatting';
import { shouldRevert } from '../_utils/testing';
import { userDeposit } from '../_helpers/deposit';
import {
  getMinipoolMinimumRPLStake,
  createMinipool,
  stakeMinipool,
} from '../_helpers/minipool';
import { registerNode, setNodeTrusted, setNodeWithdrawalAddress, nodeStakeRPL } from '../_helpers/node';
import { mintRPL } from '../_helpers/tokens';
import { close } from './scenario-close';
import { setDAOProtocolBootstrapSetting } from '../dao/scenario-dao-protocol-bootstrap';
import { voteScrub } from './scenario-scrub';
import { setDAONodeTrustedBootstrapSetting } from '../dao/scenario-dao-node-trusted-bootstrap';

export default function() {
    contract('RocketMinipool', async (accounts) => {


        // Accounts
        const [
            owner,
            node,
            nodeWithdrawalAddress,
            trustedNode1,
            trustedNode2,
            trustedNode3,
            random,
        ] = accounts;


        // Setup
        let launchTimeout = 20;
        let withdrawalDelay = 20;
        let scrubPeriod = (60 * 60 * 24); // 24 hours

        let prelaunchMinipool;

        before(async () => {

            // Register node & set withdrawal address
            await registerNode({from: node});
            await setNodeWithdrawalAddress(node, nodeWithdrawalAddress, {from: node});

            // Register trusted nodes
            await registerNode({from: trustedNode1});
            await setNodeTrusted(trustedNode1, 'saas_1', 'node@home.com', owner);
            await registerNode({from: trustedNode2});
            await setNodeTrusted(trustedNode2, 'saas_2', 'node@home.com', owner);
            await registerNode({from: trustedNode3});
            await setNodeTrusted(trustedNode3, 'saas_3', 'node@home.com', owner);

            // Set settings
            await setDAOProtocolBootstrapSetting(RocketDAOProtocolSettingsMinipool, 'minipool.launch.timeout', launchTimeout, {from: owner});
            await setDAOProtocolBootstrapSetting(RocketDAOProtocolSettingsMinipool, 'minipool.withdrawal.delay', withdrawalDelay, {from: owner});
            await setDAONodeTrustedBootstrapSetting(RocketDAONodeTrustedSettingsMinipool, 'minipool.scrub.period', scrubPeriod, {from: owner});

            // Set rETH collateralisation target to a value high enough it won't cause excess ETH to be funneled back into deposit pool and mess with our calcs
            await setDAOProtocolBootstrapSetting(RocketDAOProtocolSettingsNetwork, 'network.reth.collateral.target', web3.utils.toWei('50', 'ether'), {from: owner});

            // Make user deposit to refund first prelaunch minipool
            let refundAmount = web3.utils.toWei('16', 'ether');
            await userDeposit({from: random, value: refundAmount});

            // Stake RPL to cover minipools
            let minipoolRplStake = await getMinipoolMinimumRPLStake();
            let rplStake = minipoolRplStake.mul(web3.utils.toBN(7));
            await mintRPL(owner, node, rplStake);
            await nodeStakeRPL(rplStake, {from: node});

            // Create minipool
            prelaunchMinipool = await createMinipool({from: node, value: web3.utils.toWei('32', 'ether')});
        });


        //
        // General
        //


        it(printTitle('node', 'cannot stake a prelaunch pool if scrub period has not elapsed'), async () => {
          await shouldRevert(stakeMinipool(prelaunchMinipool, {from: node}), 'Was able to stake minipool before scrub period elapsed', 'Not enough time has passed to stake');
        });


        it(printTitle('node', 'can stake a prelaunch pool if scrub period has elapsed'), async () => {
          // Increase time by scrub period
          await increaseTime(web3, scrubPeriod + 1);
          // Should be able to stake
          await stakeMinipool(prelaunchMinipool, {from: node});
        });


        it(printTitle('node', 'cannot close a scrubbed minipool before funds are returned'), async () => {
          await voteScrub(prelaunchMinipool, {from: trustedNode1});
          await voteScrub(prelaunchMinipool, {from: trustedNode2});

          await shouldRevert(close(prelaunchMinipool, { from: node, }), 'Closed minipool before fund were returned', 'Node ETH balance was not successfully transferred to node operator');
        });


        it(printTitle('node', 'can close a scrubbed minipool after funds are returned'), async () => {
          await voteScrub(prelaunchMinipool, {from: trustedNode1});
          await voteScrub(prelaunchMinipool, {from: trustedNode2});

          // Send 16 ETH to minipool
          await web3.eth.sendTransaction({
            from: random,
            to: prelaunchMinipool.address,
            value: web3.utils.toWei('16', 'ether'),
          });

          await close(prelaunchMinipool, { from: node, });
        });


        //
        // ODAO
        //


        it(printTitle('trusted node', 'can scrub a prelaunch minipool'), async () => {
          // 2 out of 3 should dissolve the minipool
          await voteScrub(prelaunchMinipool, {from: trustedNode1});
          await voteScrub(prelaunchMinipool, {from: trustedNode2});
        });


        it(printTitle('trusted node', 'cannot vote to scrub twice'), async () => {
          await voteScrub(prelaunchMinipool, {from: trustedNode1});
          await shouldRevert(voteScrub(prelaunchMinipool, {from: trustedNode1}), 'Was able to vote scrub twice from same member', 'Member has already voted to scrub');
        });


        it(printTitle('trust node', 'cannot vote to scrub a staking minipool'), async () => {
          // Increase time by scrub period and stake
          await increaseTime(web3, scrubPeriod + 1);
          await stakeMinipool(prelaunchMinipool, {from: node});
          // Should not be able to vote scrub
          await shouldRevert(voteScrub(prelaunchMinipool, {from: trustedNode1}), 'Was able to vote scrub a staking minipool', 'The minipool can only be scrubbed while in prelaunch');
        });
    });
}
