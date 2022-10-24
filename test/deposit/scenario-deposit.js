import {
    RocketDAOProtocolSettingsDeposit,
    RocketDepositPool,
    RocketDepositPoolOld,
    RocketTokenRETH,
    RocketVault,
} from '../_utils/artifacts';


// Make a deposit into the deposit pool
export async function deposit(txOptions, preUpdate = false) {

    // Load contracts
    const [
        rocketDAOProtocolSettingsDeposit,
        rocketDepositPool,
        rocketTokenRETH,
        rocketVault,
    ] = await Promise.all([
        RocketDAOProtocolSettingsDeposit.deployed(),
        preUpdate ? RocketDepositPoolOld.deployed() : RocketDepositPool.deployed(),
        RocketTokenRETH.deployed(),
        RocketVault.deployed(),
    ]);

    // Get parameters
    let depositFeePerc = await rocketDAOProtocolSettingsDeposit.getDepositFee();

    // Get balances
    function getBalances() {
        return Promise.all([
            rocketDepositPool.getBalance.call(),
            rocketDepositPool.getNodeBalance.call(),
            web3.eth.getBalance(rocketVault.address).then(value => web3.utils.toBN(value)),
            rocketTokenRETH.balanceOf.call(txOptions.from),
        ]).then(
            ([depositPoolEth, depositPoolNodeEth, vaultEth, userReth]) =>
            ({depositPoolEth, depositPoolNodeEth, vaultEth, userReth})
        );
    }

    // Get initial balances
    let balances1 = await getBalances();

    // Deposit
    await rocketDepositPool.deposit(txOptions);

    // Get updated balances
    let balances2 = await getBalances();

    // Calculate values
    let txValue = web3.utils.toBN(txOptions.value);
    let calcBase = web3.utils.toBN(web3.utils.toWei('1', 'ether'));
    let depositFee = txValue.mul(depositFeePerc).div(calcBase);
    let expectedRethMinted = await rocketTokenRETH.getRethValue(txValue.sub(depositFee));

    // Check balances
    assert(balances2.depositPoolEth.eq(balances1.depositPoolEth.add(txValue)), 'Incorrect updated deposit pool ETH balance');
    assert(balances2.vaultEth.eq(balances1.vaultEth.add(txValue)), 'Incorrect updated vault ETH balance');
    assert(balances2.userReth.eq(balances1.userReth.add(expectedRethMinted)), 'Incorrect updated user rETH balance');

}

